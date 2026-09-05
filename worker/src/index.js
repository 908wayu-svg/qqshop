/**
 * QQSHOP Angpao Bot — Cloudflare Worker
 *
 * ลูกค้าวางลิงก์ซองอั่งเปาแล้วกดส่ง → Worker นี้กดรับซองเข้าเบอร์ทรูมันนี่ของร้าน
 * แล้วเติมเครดิตให้ลูกค้าอัตโนมัติ (ไม่ต้องรอแอดมิน)
 *
 * ค่าลับที่ต้องตั้ง (wrangler secret put ...):
 *   SA_KEY          - เนื้อไฟล์ JSON ของ service account (angpao-bot)
 *   RECEIVE_PHONE   - เบอร์ทรูมันนี่ที่รับเงิน เช่น 0918200409
 */

const PROJECT_ID = "qqshop-ecc92";
const FIREBASE_API_KEY = "AIzaSyClU0JJzyAYUmMSpANGctMVYTcKiVt_lbY";
const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const ALLOWED_ORIGINS = [
  "https://908wayu-svg.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
];

// ยิงออกนอกโดยมีเพดานเวลา — ถ้าปลายทางค้าง คำขอทั้งก้อนจะค้างตาม
// ลูกค้าจะเห็นหน้าจอหมุนไม่จบ และรายการจะค้างสถานะกลางทาง
const TIMEOUT_MS = 20000;
function fetchWithTimeout(url, opt = {}, ms = TIMEOUT_MS) {
  if (typeof AbortSignal?.timeout !== "function") return fetch(url, opt);
  return fetch(url, { ...opt, signal: AbortSignal.timeout(ms) });
}

// ---------- helpers ----------
function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

const json = (data, status, origin) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
});

// ดึงรหัสซองออกจากลิงก์
function parseAngpaoCode(link) {
  if (!link) return null;
  const s = String(link).trim();
  const m = s.match(/[?&]v=([A-Za-z0-9]+)/) || s.match(/^([A-Za-z0-9]{16,})$/);
  return m ? m[1] : null;
}

// ---------- Google service account -> access token ----------
function b64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

let cachedToken = null; // { token, exp }

async function getAccessToken(saKeyJson) {
  if (cachedToken && cachedToken.exp > Date.now() / 1000 + 60) return cachedToken.token;

  const sa = JSON.parse(saKeyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })));

  const key = await crypto.subtle.importKey(
    "pkcs8", pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key,
    new TextEncoder().encode(`${header}.${claim}`));

  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${b64url(sig)}`,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("ขอ access token ไม่สำเร็จ: " + JSON.stringify(data).slice(0, 200));

  cachedToken = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return cachedToken.token;
}

// ---------- ตรวจว่าใครเป็นคนเรียก ----------
async function verifyUser(idToken) {
  const res = await fetchWithTimeout(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
  const data = await res.json();
  const u = data.users?.[0];
  if (!u) throw new Error("unauthorized");
  return { uid: u.localId, email: u.email || "", name: u.displayName || "" };
}

// ---------- Firestore ----------
const fsValue = v =>
  v === null || v === undefined ? { nullValue: null }
  : typeof v === "boolean" ? { booleanValue: v }
  : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : v instanceof Date ? { timestampValue: v.toISOString() }
  : { stringValue: String(v) };

const fsFields = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fsValue(v)]));

async function commit(token, writes) {
  const res = await fetch(`${DB}:commit`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  const data = await res.json();
  if (data.error) throw Object.assign(new Error(data.error.message), { fsCode: data.error.status });
  return data;
}

const docPath = (col, id) => `projects/${PROJECT_ID}/databases/(default)/documents/${col}/${id}`;

async function getDocFields(token, fullPath) {
  const res = await fetch(`https://firestore.googleapis.com/v1/${fullPath}`,
    { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) return null;
  return (await res.json()).fields || null;
}

// ---------- จำกัดจำนวนครั้งต่อคน ----------
// กันคนยิงลิงก์รัวๆ จนทรูมันนี่บล็อกเซิร์ฟเวอร์เรา
const RATE_MAX = 8;          // กี่ครั้ง
const RATE_WINDOW_MS = 60000; // ต่อกี่มิลลิวินาที

async function rateLimited(token, uid) {
  const path = docPath("ratelimits", uid);
  const now = Date.now();

  let count = 0, windowStart = now;
  try {
    const res = await fetch(`https://firestore.googleapis.com/v1/${path}`,
      { headers: { Authorization: "Bearer " + token } });
    if (res.ok) {
      const f = (await res.json()).fields || {};
      const prevStart = Number(f.windowStart?.integerValue ?? 0);
      if (now - prevStart < RATE_WINDOW_MS) {
        count = Number(f.count?.integerValue ?? 0);
        windowStart = prevStart;
      }
    }
  } catch { /* อ่านไม่ได้ก็ปล่อยผ่าน ดีกว่าปิดระบบทั้งหมด */ }

  if (count >= RATE_MAX) return true;

  await commit(token, [{
    update: { name: path, fields: fsFields({ count: count + 1, windowStart, uid }) },
  }]).catch(() => {});
  return false;
}

// อ่านเอกสารหลายชิ้นพร้อมกัน
async function batchGet(token, paths) {
  const res = await fetch(`${DB}:batchGet`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ documents: paths.map(p => `projects/${PROJECT_ID}/databases/(default)/${p.replace(/^projects\/[^/]+\/databases\/\(default\)\//, "")}`) }),
  });
  const rows = await res.json();
  if (rows.error) throw new Error(rows.error.message);
  const out = {};
  for (const r of rows) {
    if (!r.found) continue;
    out[r.found.name.split("/").pop()] = r.found.fields || {};
  }
  return out;
}

const num = f => Number(f?.integerValue ?? f?.doubleValue ?? 0);

// ปัดเศษเงินเป็น 2 ตำแหน่ง กัน 19.9 * 3 = 59.699999999999996
const money2 = n => Math.round((Number(n) || 0) * 100) / 100;

// รหัสข้อผิดพลาดที่ส่งกลับให้หน้าเว็บได้ (นอกเหนือจากนี้ถือเป็นข้อผิดพลาดภายใน)
const CLIENT_ERRORS = new Set([
  "EMPTY_CART", "TOO_MANY_ITEMS", "BAD_ITEM", "BAD_QTY", "PRODUCT_NOT_FOUND",
  "PRODUCT_INACTIVE", "OUT_OF_STOCK", "BAD_PRICE", "BAD_TOTAL",
  "NO_PROFILE", "NOT_ENOUGH_CREDIT", "NEED_CUSTOMER_INFO",
]);

// ---------- สร้างออเดอร์ (คิดราคาจากฝั่งเซิร์ฟเวอร์) ----------
// เบราว์เซอร์ส่งมาแค่ "รหัสสินค้า + จำนวน" เท่านั้น ราคาทั้งหมดอ่านจากฐานข้อมูลเอง
// ลูกค้าจึงแก้ราคาไม่ได้ ต่อให้ดัดแปลงหน้าเว็บ
async function createOrder(token, user, rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw new Error("EMPTY_CART");
  if (rawItems.length > 50) throw new Error("TOO_MANY_ITEMS");

  // รวมรายการซ้ำและตรวจจำนวน
  const want = new Map();
  const info = new Map();     // ข้อมูลไอดีเกมที่ลูกค้ากรอกมา (ของเติมเกม)
  for (const it of rawItems) {
    const id = String(it?.id || "");
    const qty = Math.floor(Number(it?.qty));
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("BAD_ITEM");
    if (!Number.isFinite(qty) || qty < 1 || qty > 999) throw new Error("BAD_QTY");
    want.set(id, (want.get(id) || 0) + qty);
    // สินค้าเดียวกันส่งมาหลายแถว ใช้ค่าที่กรอกมาแถวแรกที่มีข้อมูล
    if (!info.has(id)) info.set(id, it);
  }

  const products = await batchGet(token, [...want.keys()].map(id => `documents/products/${id}`));

  let total = 0;
  const items = [];
  for (const [id, qty] of want) {
    const p = products[id];
    if (!p) throw new Error("PRODUCT_NOT_FOUND");
    if (p.active?.booleanValue === false) throw new Error("PRODUCT_INACTIVE");

    const stock = p.stock && p.stock.nullValue === undefined ? num(p.stock) : null;
    if (stock !== null && stock < qty) throw new Error("OUT_OF_STOCK");

    const price = num(p.price);
    if (price <= 0) throw new Error("BAD_PRICE");

    total = money2(total + price * qty);

    // ของเติมเกม: เก็บเฉพาะช่องที่สินค้านั้น "ติ๊กว่าขอ" เท่านั้น
    // ลูกค้าแนบอะไรมาเกินก็ไม่ถูกบันทึก และถ้าขอแล้วไม่กรอกก็สั่งไม่ผ่าน
    const asked = {};
    const raw = info.get(id) || {};
    const clean = v => String(v ?? "").trim().slice(0, 120);
    if (p.askUid?.booleanValue === true) asked.gameUid = clean(raw.gameUid);
    if (p.askLogin?.booleanValue === true) {
      asked.gameLogin = clean(raw.gameLogin);
      asked.gamePassword = clean(raw.gamePassword);
    }
    if (Object.values(asked).some(v => !v)) throw new Error("NEED_CUSTOMER_INFO");

    items.push({ id, name: p.name?.stringValue || "", price, qty, ...asked });
  }
  if (total <= 0) throw new Error("BAD_TOTAL");

  // เครดิตต้องพอตั้งแต่ตอนสั่ง (หักจริงตอนแอดมินอนุมัติ)
  const users = await batchGet(token, [`documents/users/${user.uid}`]);
  const me = users[user.uid];
  if (!me) throw new Error("NO_PROFILE");
  if (num(me.credit) < total) throw new Error("NOT_ENOUGH_CREDIT");

  const orderId = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  await commit(token, [{
    update: {
      name: docPath("orders", orderId),
      fields: {
        ...fsFields({
          uid: user.uid,
          customerName: me.name?.stringValue || user.name || "",
          customerEmail: me.email?.stringValue || user.email || "",
          total,
          status: "pending",
          createdAt: new Date(),
          serverPriced: true,     // บอกหลังบ้านว่าออเดอร์นี้ราคาผ่านการตรวจแล้ว
        }),
        items: { arrayValue: { values: items.map(i => ({ mapValue: { fields: fsFields(i) } })) } },
      },
    },
    currentDocument: { exists: false },
  }]);

  return { orderId, total, items };
}

// ---------- กดรับซองอั่งเปา ----------
async function redeemAngpao(code, phone) {
  const res = await fetchWithTimeout(`https://gift.truemoney.com/campaign/vouchers/${code}/redeem`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
      Accept: "application/json",
    },
    body: JSON.stringify({ mobile: phone, voucher_hash: code }),
  });

  let data;
  try { data = await res.json(); }
  catch { throw new Error("TRUEMONEY_BAD_RESPONSE"); }

  const code_ = data?.status?.code;
  if (code_ !== "SUCCESS") {
    throw Object.assign(new Error(code_ || "REDEEM_FAILED"), { tmCode: code_, tmData: data });
  }

  const amount = Number(
    data?.data?.my_ticket?.amount_baht ?? data?.data?.voucher?.redeemed_amount_baht ?? 0);
  if (!amount || amount <= 0) throw new Error("ZERO_AMOUNT");
  return { amount, raw: data };
}

// เปิดไว้ให้สคริปต์ทดสอบเรียกใช้ (Cloudflare ใช้แค่ default export)
export { parseAngpaoCode, getAccessToken, commit, docPath, fsFields, fsValue, redeemAngpao, createOrder, batchGet };

// ---------- main ----------
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: "BAD_ORIGIN" }, 403, origin);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: "BAD_JSON" }, 400, origin); }

    // ผู้เรียกต้องเป็นสมาชิกที่ล็อกอินจริง (ใช้ร่วมกันทุกเส้นทาง)
    let user;
    try { user = await verifyUser(body.idToken); }
    catch { return json({ ok: false, error: "UNAUTHORIZED" }, 401, origin); }

    let token;
    try { token = await getAccessToken(env.SA_KEY); }
    catch (e) {
      console.error("getAccessToken", e);
      return json({ ok: false, error: "SERVER_NOT_READY" }, 503, origin);
    }

    if (await rateLimited(token, user.uid)) {
      return json({ ok: false, error: "RATE_LIMITED" }, 429, origin);
    }

    // ===== เส้นทางสั่งซื้อ =====
    if (new URL(request.url).pathname.replace(/\/$/, "") === "/order") {
      try {
        const r = await createOrder(token, user, body.items);
        return json({ ok: true, ...r }, 200, origin);
      } catch (e) {
        // ข้อความผิดพลาดภายใน (เช่น Firestore ล่ม) ไม่ควรหลุดออกไปหน้าเว็บ
        const code = CLIENT_ERRORS.has(e.message) ? e.message : "ORDER_FAILED";
        if (code === "ORDER_FAILED") console.error("createOrder", e);
        return json({ ok: false, error: code }, 400, origin);
      }
    }

    // ===== เส้นทางรับซองอั่งเปา =====
    const code = parseAngpaoCode(body.link);
    if (!code) return json({ ok: false, error: "INVALID_LINK" }, 400, origin);

    const phone = env.RECEIVE_PHONE;
    if (!phone) return json({ ok: false, error: "SERVER_NOT_READY" }, 503, origin);

    // ต้องมีเอกสารสมาชิกอยู่ก่อน — คำสั่งเพิ่มเครดิตเป็น transform
    // ถ้ายิงใส่เอกสารที่ยังไม่มี Firestore จะสร้างเอกสารที่มีแค่ credit
    // กลายเป็นสมาชิกผีที่ไม่มีชื่อ/อีเมล/สิทธิ์ โผล่ในหลังบ้านแบบว่างเปล่า
    const prof = await batchGet(token, [`documents/users/${user.uid}`]).catch(() => ({}));
    if (!prof[user.uid]) return json({ ok: false, error: "NO_PROFILE" }, 400, origin);

    const topupDoc = docPath("topups", "angpao_" + code);

    // 3) จองรหัสซองนี้ไว้ก่อน — ถ้ามีคนใช้ไปแล้วจะเขียนไม่สำเร็จ (กันใช้ซ้ำ/ยิงพร้อมกัน)
    let reservedAt = null;
    try {
      const r = await commit(token, [{
        update: {
          name: topupDoc,
          fields: fsFields({
            uid: user.uid, name: user.name, email: user.email,
            amount: 0, method: "angpao", angpaoCode: code,
            angpaoLink: String(body.link).slice(0, 500),
            receivePhone: phone, auto: true,
            status: "processing", createdAt: new Date(),
          }),
        },
        currentDocument: { exists: false },
      }]);
      reservedAt = r?.writeResults?.[0]?.updateTime || null;
    } catch (e) {
      return json({ ok: false, error: "ALREADY_USED" }, 409, origin);
    }

    // 4) กดรับซองเข้าเบอร์ร้าน
    let result;
    try {
      result = await redeemAngpao(code, phone);
    } catch (e) {
      const why = e.tmCode || e.message;

      // ทรูบอกว่าเบอร์ร้านรับซองนี้ไปแล้ว = เงินอาจเข้าไปแล้วแต่บันทึกไม่ทัน
      // เก็บไว้เป็นรออนุมัติ ให้แอดมินตรวจแล้วกดเติมเครดิตเอง (เคสเดียวที่ต้องเก็บ)
      if (["TARGET_USER_REDEEMED", "VOUCHER_HAS_BEEN_USED"].includes(why)) {
        await commit(token, [{
          update: {
            name: topupDoc,
            fields: fsFields({ status: "pending", note: "ต้องตรวจสอบด้วยมือ: " + why }),
          },
          updateMask: { fieldPaths: ["status", "note"] },
        }]).catch(() => {});
      }
      // กรณีอื่น (ซองไม่มีจริง/หมดอายุ/ทรูล่ม) -> ลบการจองทิ้ง
      // ลูกค้ายิงซองเดิมใหม่ได้ และคนยิงลิงก์มั่วก็ถมฐานข้อมูลไม่ได้
      else {
        await commit(token, [{ delete: topupDoc }]).catch(() => {});
      }
      return json({ ok: false, error: why }, 400, origin);
    }

    // 5) สำเร็จ — เติมเครดิตให้ลูกค้า + ปิดรายการ ในคำสั่งเดียว (atomic)
    // currentDocument.updateTime = ต้องยังไม่มีใครแตะเอกสารนี้ตั้งแต่ตอนจอง
    // ถ้าแอดมินเผลออนุมัติไปก่อน คำสั่งนี้จะถูกปฏิเสธทั้งชุด เครดิตจึงไม่เข้าซ้ำ
    const amount = money2(result.amount);
    const closeWrites = [
      {
        update: {
          name: topupDoc,
          fields: fsFields({
            amount, status: "approved",
            approvedAt: new Date(), approvedBy: "angpao-bot",
          }),
        },
        updateMask: { fieldPaths: ["amount", "status", "approvedAt", "approvedBy"] },
        ...(reservedAt ? { currentDocument: { updateTime: reservedAt } } : {}),
      },
      {
        transform: {
          document: docPath("users", user.uid),
          fieldTransforms: [{ fieldPath: "credit", increment: fsValue(amount) }],
        },
      },
    ];

    try {
      await commit(token, closeWrites);
      return json({ ok: true, amount }, 200, origin);
    } catch (e) {
      // เงินเข้าร้านแล้วแต่บันทึกไม่สำเร็จ — ห้ามปล่อยให้ค้างสถานะ processing เงียบๆ
      console.error("close angpao failed", e);

      // แอดมินอนุมัติตัดหน้าไปแล้ว = เครดิตเข้าเรียบร้อย ไม่ต้องทำอะไรต่อ
      const cur = await getDocFields(token, topupDoc).catch(() => null);
      if (cur?.status?.stringValue === "approved") {
        return json({ ok: true, amount: num(cur.amount) || amount }, 200, origin);
      }

      // ที่เหลือ: พักไว้เป็น "รออนุมัติ" พร้อมยอดจริง ให้แอดมินกดยืนยันแทน
      const parked = await commit(token, [{
        update: {
          name: topupDoc,
          fields: fsFields({
            amount, status: "pending",
            note: "บอทรับซองสำเร็จแล้ว (" + amount + " บาท) แต่เติมเครดิตอัตโนมัติไม่สำเร็จ กรุณากดอนุมัติ",
          }),
        },
        updateMask: { fieldPaths: ["amount", "status", "note"] },
      }]).then(() => true).catch(() => false);

      return json({ ok: false, error: parked ? "CREDIT_PENDING_ADMIN" : "CREDIT_FAILED", amount }, 202, origin);
    }
  },
};
