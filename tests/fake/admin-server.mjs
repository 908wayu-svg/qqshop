// ===== เซิร์ฟเวอร์แอดมินจำลอง (แทน /admin/* ของ Cloudflare Worker) =====
// ทำงานบนฐานข้อมูลจำลองโดย "ไม่ผ่านกฎ" เหมือน service account ตัวจริง
// ตรรกะทุกอย่างต้องตรงกับ worker/src/index.js — แก้ที่โน่นแล้วต้องแก้ที่นี่ด้วย
import { state, claimsOf, Timestamp } from "./store.mjs";

const money2 = n => Math.round((Number(n) || 0) * 100) / 100;
const now = () => new Timestamp(Date.now());
const isId = s => /^[A-Za-z0-9_-]{1,64}$/.test(String(s ?? ""));
const OPEN_TOPUP = ["pending", "processing"];

// เก็บบันทึกการกระทำของแอดมิน (adminLogs) — ลบ/แก้จากเบราว์เซอร์ไม่ได้
let logSeq = 0;
function audit(admin, action, detail = {}) {
  const id = "log" + (++logSeq);
  state.docs.set("adminLogs/" + id, {
    at: now(), action, byUid: admin.uid, byEmail: admin.email || "", ...detail,
  });
}

class Fail extends Error {}
const fail = code => { throw new Fail(code); };

// อ่าน/เขียนตรงๆ ไม่ผ่าน can()
const get = path => state.docs.get(path);
const set = (path, data) => state.docs.set(path, data);
const patch = (path, data) => state.docs.set(path, { ...(state.docs.get(path) || {}), ...data });

// ---------- ตรวจสิทธิ์แอดมิน 2 ชั้น (claim + เอกสาร) ----------
function requireAdmin(user) {
  if (claimsOf(user.uid).admin !== true) fail("ADMIN_ONLY");
  const me = get("users/" + user.uid);
  if (!me || me.role !== "admin") fail("ADMIN_ONLY");
  return { uid: user.uid, email: user.email || me.email || "" };
}

// ---------- ปรับเครดิต ----------
function adjustCredit(admin, { uid, amount, note = "" }) {
  if (!isId(uid)) fail("BAD_REQUEST");
  const amt = money2(amount);
  if (!Number.isFinite(amt) || amt === 0) fail("AMOUNT_INVALID");
  if (Math.abs(amt) > 100000) fail("AMOUNT_TOO_LARGE");

  const u = get("users/" + uid);
  if (!u) fail("MEMBER_NOT_FOUND");
  const before = money2(u.credit || 0);
  const after = money2(before + amt);
  if (after < 0) fail("WOULD_GO_NEGATIVE");

  const logId = "adm" + (++logSeq);
  patch("users/" + uid, { credit: after });
  set("topups/" + logId, {
    uid, name: u.name || "", email: u.email || "",
    amount: amt, method: "admin", note: String(note).slice(0, 300),
    status: "approved", createdAt: now(), approvedAt: now(), approvedBy: admin.email || "",
  });
  audit(admin, "credit.adjust", { targetUid: uid, amount: amt, before, after });
  return { logId, before, after };
}

// ---------- เติมเงิน ----------
function approveTopup(admin, { topupId, amount = null }) {
  if (!isId(topupId)) fail("BAD_REQUEST");
  const tp = get("topups/" + topupId);
  if (!tp) fail("NOT_FOUND");
  if (!OPEN_TOPUP.includes(tp.status)) fail("ALREADY_HANDLED");

  const amt = money2(amount === null || amount === undefined || amount === "" ? tp.amount : amount);
  if (!Number.isFinite(amt) || amt <= 0) fail("AMOUNT_MISSING");
  if (amt > 100000) fail("AMOUNT_TOO_LARGE");

  const u = get("users/" + tp.uid);
  if (!u) fail("MEMBER_NOT_FOUND");
  const before = money2(u.credit || 0);
  const after = money2(before + amt);

  patch("users/" + tp.uid, { credit: after });
  patch("topups/" + topupId, {
    amount: amt, status: "approved", approvedAt: now(), approvedBy: admin.email || "",
  });
  audit(admin, "topup.approve", { topupId, targetUid: tp.uid, amount: amt, before, after });
  return { amount: amt, before, after };
}

function rejectTopup(admin, { topupId, note = "" }) {
  if (!isId(topupId)) fail("BAD_REQUEST");
  const tp = get("topups/" + topupId);
  if (!tp) fail("NOT_FOUND");
  if (!OPEN_TOPUP.includes(tp.status)) fail("ALREADY_HANDLED");
  patch("topups/" + topupId, {
    status: "rejected", note: String(note).slice(0, 300),
    approvedAt: now(), approvedBy: admin.email || "",
  });
  audit(admin, "topup.reject", { topupId, targetUid: tp.uid });
  return { ok: true };
}

// ---------- ออเดอร์ ----------
function stockItemsOf(pid) {
  const prefix = "products/" + pid + "/stockItems/";
  return [...state.docs.entries()]
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ path: k, data: v }))
    .sort((a, b) => (a.data.sort ?? 0) - (b.data.sort ?? 0)
      || a.path.localeCompare(b.path));
}

// อนุมัติออเดอร์แบบเดิม — ใช้ได้เฉพาะออเดอร์เก่าที่ยังไม่ได้หักเครดิต (ไม่มี paid)
function approveOrder(admin, { orderId }) {
  if (!isId(orderId)) fail("BAD_REQUEST");
  const o = get("orders/" + orderId);
  if (!o) fail("NOT_FOUND");
  if (o.paid === true) fail("NEW_FLOW_ORDER");
  if (o.status !== "pending") fail("ALREADY_HANDLED");

  const items = (o.items || []).map(i => ({ ...i }));
  const total = money2(o.total || 0);
  const u = get("users/" + o.uid);
  if (!u) fail("MEMBER_NOT_FOUND");
  const before = money2(u.credit || 0);
  if (before < total) fail("INSUFFICIENT_CUSTOMER_CREDIT");

  const wanted = new Map();
  for (const i of items) {
    if (!isId(String(i.id))) fail("BAD_REQUEST");
    wanted.set(String(i.id), (wanted.get(String(i.id)) || 0) + Math.floor(Number(i.qty || 0)));
  }

  // จองไอดีในคลังของสินค้าดิจิทัล
  const picked = {};
  for (const [pid, qty] of wanted) {
    const p = get("products/" + pid);
    if (!p || p.digital !== true) continue;
    const avail = stockItemsOf(pid).filter(s => s.data.status === "available").slice(0, qty);
    if (avail.length < qty) fail("NOT_ENOUGH_STOCK_ITEMS");
    for (const s of avail) {
      if (!String(s.data.login || "").trim() && !String(s.data.password || "").trim()) {
        fail("EMPTY_STOCK_ITEM");
      }
    }
    picked[pid] = avail;
  }

  // ตัดสต๊อก (เฉพาะสินค้าที่กำหนดจำนวนไว้)
  const stockWrites = [];
  for (const [pid, qty] of wanted) {
    const p = get("products/" + pid);
    if (!p) continue;
    if (p.stock === null || p.stock === undefined) continue;
    const left = Number(p.stock) - qty;
    if (left < 0) fail("OUT_OF_STOCK");
    stockWrites.push([pid, left]);
  }

  const queue = Object.fromEntries(Object.entries(picked).map(([pid, arr]) => [pid, [...arr]]));
  const newItems = items.map(i => {
    const pid = String(i.id);
    if (!queue[pid]) return i;
    const take = queue[pid].splice(0, Math.floor(Number(i.qty || 0)));
    if (take.length < Math.floor(Number(i.qty || 0))) fail("STOCK_ITEM_TAKEN");
    return {
      ...i,
      delivered: take.map(s => ({
        login: s.data.login || "", password: s.data.password || "", note: s.data.note || "",
      })),
    };
  });

  // ---- ตรวจครบแล้วค่อยเขียน ----
  const after = money2(before - total);
  stockWrites.forEach(([pid, left]) => patch("products/" + pid, { stock: left }));
  for (const [pid, arr] of Object.entries(picked)) {
    for (const s of arr) {
      patch(s.path, { status: "sold", orderId, uid: o.uid, soldAt: now() });
    }
  }
  patch("users/" + o.uid, { credit: after });
  patch("orders/" + orderId, {
    items: newItems, status: "approved", approvedAt: now(), approvedBy: admin.email || "",
  });
  audit(admin, "order.approve", { orderId, targetUid: o.uid, amount: total, before, after });
  return { total, before, after };
}

function rejectOrder(admin, { orderId, note = "" }) {
  if (!isId(orderId)) fail("BAD_REQUEST");
  const o = get("orders/" + orderId);
  if (!o) fail("NOT_FOUND");
  if (o.paid === true) fail("NEW_FLOW_ORDER");
  if (o.status !== "pending") fail("ALREADY_HANDLED");
  patch("orders/" + orderId, {
    status: "rejected", note: String(note).slice(0, 300),
    approvedAt: now(), approvedBy: admin.email || "",
  });
  audit(admin, "order.reject", { orderId, targetUid: o.uid });
  return { ok: true };
}

// ===== ออเดอร์ระบบใหม่: 3 สถานะ + ยกเลิกคืนเครดิต =====
// ตรรกะต้องตรงกับ adminStartOrder / adminCompleteOrder / adminCancelOrder ใน worker/src/index.js
function startOrder(admin, { orderId }) {
  if (!isId(orderId)) fail("BAD_REQUEST");
  const o = get("orders/" + orderId);
  if (!o) fail("NOT_FOUND");
  if (o.paid !== true) fail("OLD_ORDER");
  if (o.status !== "pending") fail("ALREADY_HANDLED");
  patch("orders/" + orderId, { status: "processing", startedAt: now(), handledBy: admin.email || "" });
  audit(admin, "order.start", { orderId, targetUid: o.uid });
  return { status: "processing" };
}

function completeOrder(admin, { orderId }) {
  if (!isId(orderId)) fail("BAD_REQUEST");
  const o = get("orders/" + orderId);
  if (!o) fail("NOT_FOUND");
  if (o.paid !== true) fail("OLD_ORDER");
  // กันกดข้ามขั้น ต้องผ่าน "เริ่มดำเนินการ" มาก่อนเสมอ
  if (o.status !== "processing") fail("ALREADY_HANDLED");

  const before = o.items || [];
  const hadSecret = before.some(i => i.gameLogin || i.gamePassword);
  const items = before.map(({ gameLogin, gamePassword, ...keep }) => keep);
  patch("orders/" + orderId, {
    items, status: "completed", completedAt: now(), claimTimerStartedAt: now(),
    handledBy: admin.email || "", ...(hadSecret ? { customerInfoClearedAt: now() } : {}),
  });
  audit(admin, "order.complete", { orderId, targetUid: o.uid, clearedInfo: hadSecret });
  return { status: "completed", clearedInfo: hadSecret };
}

const CANCELLABLE = ["pending", "processing", "completed"];

function cancelOrder(admin, { orderId, note = "" }) {
  if (!isId(orderId)) fail("BAD_REQUEST");
  const o = get("orders/" + orderId);
  if (!o) fail("NOT_FOUND");
  if (o.paid !== true) fail("OLD_ORDER");
  if (!CANCELLABLE.includes(o.status)) fail("ALREADY_HANDLED");

  const refund = money2(o.total || 0);
  if (!o.uid || !(refund > 0)) fail("BAD_REQUEST");
  const u = get("users/" + o.uid);
  if (!u) fail("MEMBER_NOT_FOUND");
  const before = money2(u.credit || 0);
  const after = money2(before + refund);

  // คืนสต๊อกเฉพาะของที่ยังไม่ได้ส่งมอบ (ไอดีที่ลูกค้าเห็นรหัสไปแล้วเอากลับมาขายไม่ได้)
  const restore = new Map();
  for (const i of o.items || []) {
    if (Array.isArray(i.delivered) && i.delivered.length) continue;
    const qty = Math.floor(Number(i.qty));
    if (!isId(String(i.id)) || !Number.isFinite(qty) || qty < 1) continue;
    restore.set(String(i.id), (restore.get(String(i.id)) || 0) + qty);
  }
  for (const [pid, qty] of restore) {
    const p = get("products/" + pid);
    if (!p || p.stock === null || p.stock === undefined) continue;
    patch("products/" + pid, { stock: Number(p.stock) + qty });
  }

  patch("users/" + o.uid, { credit: after });
  patch("orders/" + orderId, {
    status: "cancelled", note: String(note).slice(0, 300), refundAmount: refund,
    cancelledAt: now(), handledBy: admin.email || "",
  });
  audit(admin, "order.cancel", { orderId, targetUid: o.uid, amount: refund, before, after });
  return { refund, before, after, status: "cancelled" };
}

function clearOrderInfo(admin, { orderId }) {
  if (!isId(orderId)) fail("BAD_REQUEST");
  const o = get("orders/" + orderId);
  if (!o) fail("NOT_FOUND");
  const items = (o.items || []).map(({ gameLogin, gamePassword, ...keep }) => keep);
  patch("orders/" + orderId, { items, customerInfoClearedAt: now() });
  audit(admin, "order.clearInfo", { orderId, targetUid: o.uid });
  return { ok: true };
}

// ---------- สิทธิ์แอดมิน ----------
function setRole(admin, { uid, makeAdmin }) {
  if (!isId(uid)) fail("BAD_REQUEST");
  if (typeof makeAdmin !== "boolean") fail("BAD_REQUEST");
  if (uid === admin.uid) fail("CANNOT_CHANGE_SELF");
  const target = get("users/" + uid);
  if (!target) fail("MEMBER_NOT_FOUND");

  if (makeAdmin) {
    state.claims.set(uid, { admin: true });
    patch("users/" + uid, { role: "admin" });
    audit(admin, "role.grant", { targetUid: uid, targetEmail: target.email || "" });
  } else {
    patch("users/" + uid, { role: "member" });
    state.claims.set(uid, {});
    audit(admin, "role.revoke", { targetUid: uid, targetEmail: target.email || "" });
  }
  return { uid, admin: makeAdmin };
}

// รหัสลับของ /admin/bootstrap ในโหมดทดสอบ
export let BOOTSTRAP_SECRET = "test-bootstrap-secret-0123456789";
export const setBootstrapSecret = s => { BOOTSTRAP_SECRET = s; };

function bootstrap(user, { secret }) {
  if (String(BOOTSTRAP_SECRET || "").length < 16) fail("BOOTSTRAP_DISABLED");
  if (String(secret ?? "") !== BOOTSTRAP_SECRET) fail("BOOTSTRAP_BAD_SECRET");
  if (!get("users/" + user.uid)) fail("NO_PROFILE");
  state.claims.set(user.uid, { admin: true });
  patch("users/" + user.uid, { role: "admin" });
  audit({ uid: user.uid, email: user.email }, "role.bootstrap", { targetUid: user.uid });
  return { uid: user.uid, admin: true };
}

function whoami(user) {
  const me = get("users/" + user.uid);
  const claim = claimsOf(user.uid).admin === true;
  const role = me?.role || "";
  return { uid: user.uid, claim, role, admin: claim && role === "admin" };
}

// ===== ฝั่งลูกค้า: สร้างออเดอร์ + แก้ข้อมูลไอดีเกม (แทน /order ของ Worker) =====
// ตรรกะต้องตรงกับ createOrder / updateOrderInfo ใน worker/src/index.js
// หัวใจคือ "หักเครดิต + จ่ายของ" เกิดขึ้นตั้งแต่ตอนลูกค้ากดสั่ง ไม่ใช่ตอนแอดมินอนุมัติ
let orderSeq = 0;

function createOrder(user, rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) fail("EMPTY_CART");
  if (rawItems.length > 50) fail("TOO_MANY_ITEMS");

  const want = new Map(), info = new Map();
  for (const it of rawItems) {
    const id = String(it?.id || "");
    const qty = Math.floor(Number(it?.qty));
    if (!isId(id)) fail("BAD_ITEM");
    if (!Number.isFinite(qty) || qty < 1 || qty > 999) fail("BAD_QTY");
    want.set(id, (want.get(id) || 0) + qty);
    if (!info.has(id)) info.set(id, it);
  }

  let total = 0, allDigital = true;
  const items = [];
  for (const [id, qty] of want) {
    const p = get("products/" + id);
    if (!p) fail("PRODUCT_NOT_FOUND");
    if (p.active === false) fail("PRODUCT_INACTIVE");
    if (p.stock !== null && p.stock !== undefined && Number(p.stock) < qty) fail("OUT_OF_STOCK");
    const price = money2(p.price);
    if (!(price > 0)) fail("BAD_PRICE");
    total = money2(total + price * qty);

    const asked = {};
    const raw = info.get(id) || {};
    const clean = v => String(v ?? "").trim().slice(0, 120);
    if (p.askUid === true) asked.gameUid = clean(raw.gameUid);
    if (p.askLogin === true) {
      asked.gameLogin = clean(raw.gameLogin);
      asked.gamePassword = clean(raw.gamePassword);
    }
    if (Object.values(asked).some(v => !v)) fail("NEED_CUSTOMER_INFO");

    if (p.digital !== true) allDigital = false;
    items.push({ id, name: p.name || "", price, qty, ...asked });
  }
  if (!(total > 0)) fail("BAD_TOTAL");

  const me = get("users/" + user.uid);
  if (!me) fail("NO_PROFILE");
  const before = money2(me.credit || 0);
  if (!Number.isFinite(before) || before < total) fail("NOT_ENOUGH_CREDIT");

  // จองไอดีในคลังของสินค้าดิจิทัล
  const picked = {};
  for (const [pid, qty] of want) {
    const p = get("products/" + pid);
    if (p.digital !== true) continue;
    const avail = stockItemsOf(pid).filter(s => s.data.status === "available").slice(0, qty);
    if (avail.length < qty) fail("OUT_OF_STOCK");
    for (const s of avail) {
      if (!String(s.data.login || "").trim() && !String(s.data.password || "").trim()) fail("ITEM_NOT_READY");
    }
    picked[pid] = avail;
  }

  // ---- ตรวจครบแล้วค่อยเขียน ----
  const orderId = "ord" + (++orderSeq) + Math.random().toString(36).slice(2, 8);
  for (const [pid, qty] of want) {
    const p = get("products/" + pid);
    if (p.stock === null || p.stock === undefined) continue;
    const left = Number(p.stock) - qty;
    if (left < 0) fail("OUT_OF_STOCK");
    patch("products/" + pid, { stock: left });
  }

  const queue = Object.fromEntries(Object.entries(picked).map(([pid, arr]) => [pid, [...arr]]));
  const finalItems = items.map(i => {
    if (!queue[i.id]) return i;
    const take = queue[i.id].splice(0, i.qty);
    if (take.length < i.qty) fail("OUT_OF_STOCK");
    return {
      ...i,
      delivered: take.map(s => ({
        login: s.data.login || "", password: s.data.password || "", note: s.data.note || "",
      })),
    };
  });
  for (const arr of Object.values(picked)) {
    for (const s of arr) patch(s.path, { status: "sold", orderId, uid: user.uid, soldAt: now() });
  }

  const after = money2(before - total);
  patch("users/" + user.uid, { credit: after });
  const at = now();
  set("orders/" + orderId, {
    uid: user.uid, customerName: me.name || "", customerEmail: me.email || "",
    items: finalItems, total, status: allDigital ? "completed" : "pending",
    kind: allDigital ? "digital" : "topup", paid: true, serverPriced: true,
    createdAt: at, paidAt: at, creditBefore: before, creditAfter: after,
    ...(allDigital ? { claimTimerStartedAt: at, completedAt: at } : {}),
  });
  return { orderId, total, kind: allDigital ? "digital" : "topup",
    status: allDigital ? "completed" : "pending", credit: after };
}

function updateOrderInfo(user, { orderId, items: patchItems }) {
  if (!isId(orderId)) fail("BAD_ITEM");
  if (!Array.isArray(patchItems) || !patchItems.length || patchItems.length > 50) fail("BAD_ITEM");

  const byIndex = new Map();
  for (const p of patchItems) {
    const idx = Math.floor(Number(p?.index));
    if (!Number.isFinite(idx) || idx < 0 || idx > 999) fail("BAD_ITEM");
    byIndex.set(idx, p);
  }

  const o = get("orders/" + orderId);
  // ออเดอร์ของคนอื่นตอบเหมือนไม่มีอยู่ ไม่บอกใบ้ว่ามีจริงไหม
  if (!o || o.uid !== user.uid) fail("ORDER_NOT_FOUND");
  if (o.status !== "pending") fail("EDIT_LOCKED");

  const clean = v => String(v ?? "").trim().slice(0, 120);
  const edits = Array.isArray(o.infoEdits) ? [...o.infoEdits] : [];
  const at = now();
  let changed = 0;
  const next = (o.items || []).map((it, idx) => {
    const p = byIndex.get(idx);
    if (!p) return it;
    const out = { ...it };
    for (const k of ["gameUid", "gameLogin", "gamePassword"]) {
      if (!(k in it) || !(k in p)) continue;
      const v = clean(p[k]);
      if (!v) fail("NEED_CUSTOMER_INFO");
      if (v === it[k]) continue;
      edits.push({ at, index: idx, field: k, from: k === "gamePassword" ? "***" : String(it[k] ?? "") });
      out[k] = v;
      changed++;
    }
    return out;
  });
  if (!changed) return { ok: true, changed: 0 };
  if (edits.length > 100) edits.splice(0, edits.length - 100);
  patch("orders/" + orderId, { items: next, infoEdits: edits, infoEditedAt: at });
  return { ok: true, changed };
}

// ---------- ตัวรับคำขอ ----------
export const calls = [];          // เก็บไว้ให้เทสต์ตรวจว่ายิงไปที่ไหนบ้าง
export let OFFLINE = false;       // จำลองเซิร์ฟเวอร์ล่ม
export const setOffline = v => { OFFLINE = v; };

export function handleAdmin(path, body) {
  calls.push({ path, body });
  if (OFFLINE) throw new Error("network");

  const uid = String(body.idToken || "").replace(/^token:/, "");
  const acc = state.user && state.user.uid === uid ? state.user : { uid, email: "" };
  if (!uid) return { status: 401, data: { ok: false, error: "UNAUTHORIZED" } };
  const user = { uid, email: acc.email || "" };

  try {
    let out;
    if (path === "/admin/bootstrap") out = bootstrap(user, body);
    else if (path === "/admin/whoami") out = whoami(user);
    else {
      const admin = requireAdmin(user);
      switch (path) {
        case "/admin/credit": out = adjustCredit(admin, body); break;
        case "/admin/topup/approve": out = approveTopup(admin, body); break;
        case "/admin/topup/reject": out = rejectTopup(admin, body); break;
        case "/admin/order/approve": out = approveOrder(admin, body); break;
        case "/admin/order/reject": out = rejectOrder(admin, body); break;
        case "/admin/order/start": out = startOrder(admin, body); break;
        case "/admin/order/complete": out = completeOrder(admin, body); break;
        case "/admin/order/cancel": out = cancelOrder(admin, body); break;
        case "/admin/order/clear-info": out = clearOrderInfo(admin, body); break;
        case "/admin/role": out = setRole(admin, body); break;
        default: fail("NOT_FOUND");
      }
    }
    return { status: 200, data: { ok: true, ...out } };
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    const code = e.message;
    const status = code === "ADMIN_ONLY" ? 403 : 400;
    return { status, data: { ok: false, error: code } };
  }
}

// เส้นทางฝั่งลูกค้า (/order, /order/edit-info) — ตรวจแค่ว่าล็อกอินจริง ไม่ต้องเป็นแอดมิน
export function handleOrder(path, body) {
  calls.push({ path, body });
  if (OFFLINE) throw new Error("network");

  const uid = String(body.idToken || "").replace(/^token:/, "");
  if (!uid) return { status: 401, data: { ok: false, error: "UNAUTHORIZED" } };
  const acc = state.user && state.user.uid === uid ? state.user : { uid, email: "" };
  const user = { uid, email: acc.email || "" };

  try {
    const out = path === "/order"
      ? createOrder(user, body.items)
      : updateOrderInfo(user, body);
    return { status: 200, data: { ok: true, ...out } };
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    return { status: 400, data: { ok: false, error: e.message } };
  }
}

// ต่อท้าย fetch เดิม — คำขอที่ไม่ใช่ของเรา ส่งต่อให้ตัวเดิมจัดการ
export function installAdminServer() {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url);
    const i = u.indexOf("/admin/");
    if (i >= 0) {
      const path = u.slice(i);
      const body = opt.body ? JSON.parse(opt.body) : {};
      const r = handleAdmin(path, body);
      return { ok: r.status < 400, status: r.status, json: async () => r.data };
    }
    const j = u.indexOf("/order");
    if (j >= 0) {
      const path = u.slice(j).replace(/\/+$/, "");
      const body = opt.body ? JSON.parse(opt.body) : {};
      const r = handleOrder(path, body);
      return { ok: r.status < 400, status: r.status, json: async () => r.data };
    }
    if (prev) return prev(url, opt);
    throw new Error("no fetch handler for " + u);
  };
  return () => { globalThis.fetch = prev; };
}
