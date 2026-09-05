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

function approveOrder(admin, { orderId }) {
  if (!isId(orderId)) fail("BAD_REQUEST");
  const o = get("orders/" + orderId);
  if (!o) fail("NOT_FOUND");
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
  if (o.status !== "pending") fail("ALREADY_HANDLED");
  patch("orders/" + orderId, {
    status: "rejected", note: String(note).slice(0, 300),
    approvedAt: now(), approvedBy: admin.email || "",
  });
  audit(admin, "order.reject", { orderId, targetUid: o.uid });
  return { ok: true };
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

// ต่อท้าย fetch เดิม — คำขอที่ไม่ใช่ /admin/ ส่งต่อให้ตัวเดิมจัดการ
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
    if (prev) return prev(url, opt);
    throw new Error("no fetch handler for " + u);
  };
  return () => { globalThis.fetch = prev; };
}
