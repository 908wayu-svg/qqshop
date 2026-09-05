/**
 * QQSHOP Server — Cloudflare Worker
 *
 * ที่นี่คือ "ฝั่งเซิร์ฟเวอร์" ที่เดียวของร้าน ทุกอย่างที่แตะเงินหรือสิทธิ์ต้องผ่านที่นี่:
 *   - ลูกค้า: สร้างออเดอร์ (/order) · กดรับซองอั่งเปา (/)
 *   - แอดมิน: อนุมัติออเดอร์/เติมเงิน · ปรับเครดิต · ตั้ง-ถอดสิทธิ์แอดมิน (/admin/*)
 *
 * ทำไมทุกอย่างต้องผ่านที่นี่:
 *   firestore.rules ปิดไม่ให้เบราว์เซอร์เขียน credit / role ของใครทั้งสิ้น (แม้แต่แอดมินเอง)
 *   ต่อให้บัญชีแอดมินหลุดมือ คนที่ได้ไปก็เติมเครดิตให้ตัวเองผ่าน Firestore ตรงๆ ไม่ได้
 *   ต้องยิงผ่านเส้นทาง /admin/* นี้ ซึ่งตรวจสิทธิ์ 2 ชั้นและบันทึกทุกครั้งลง adminLogs
 *
 * ค่าลับที่ต้องตั้ง (wrangler secret put ...):
 *   SA_KEY            - เนื้อไฟล์ JSON ของ service account
 *                       ต้องมีสิทธิ์ Firestore + Firebase Authentication Admin
 *                       (อย่างหลังใช้ตั้ง custom claim ของแอดมิน)
 *   RECEIVE_PHONE     - เบอร์ทรูมันนี่ที่รับเงิน เช่น 0918200409
 *   ADMIN_BOOTSTRAP   - รหัสลับตั้งแอดมินคนแรก / กู้คืนตอนหลุดสิทธิ์ทั้งหมด (อย่างน้อย 16 ตัว)
 */

const PROJECT_ID = "qqshop-ecc92";
const FIREBASE_API_KEY = "AIzaSyClU0JJzyAYUmMSpANGctMVYTcKiVt_lbY";
const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const IDTOOLKIT = "https://identitytoolkit.googleapis.com/v1";

// สิทธิ์ที่ขอจาก Google — แยกใบตามงาน ไม่ขอเกินที่ต้องใช้
const SCOPE_DB = "https://www.googleapis.com/auth/datastore";
const SCOPE_AUTH = "https://www.googleapis.com/auth/identitytoolkit";

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

// เทียบความลับแบบไม่ให้เดาจากเวลาที่ใช้ตอบ (กันเดารหัสทีละตัวอักษร)
function safeEqual(a, b) {
  const x = String(a ?? ""), y = String(b ?? "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

const isId = s => /^[A-Za-z0-9_-]{1,64}$/.test(String(s ?? ""));

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

// เก็บโทเคนแยกตามสิทธิ์ที่ขอ (ฐานข้อมูล / ระบบสมาชิก) ใบหนึ่งใช้แทนอีกใบไม่ได้
const tokenCache = new Map();

async function getAccessToken(saKeyJson, scope = SCOPE_DB) {
  const hit = tokenCache.get(scope);
  if (hit && hit.exp > Date.now() / 1000 + 60) return hit.token;

  const sa = JSON.parse(saKeyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope,
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

  tokenCache.set(scope, { token: data.access_token, exp: now + (data.expires_in || 3600) });
  return data.access_token;
}

// ---------- ตรวจว่าใครเป็นคนเรียก ----------
// อ่าน custom claim จาก "บัญชีจริง" ที่ Firebase ไม่ใช่จากโทเคนที่เบราว์เซอร์ส่งมา
// เพราะโทเคนที่ออกก่อนถอนสิทธิ์จะยังมี admin:true ค้างอยู่ได้ถึง 1 ชั่วโมง
// อ่านจากบัญชีจริง = ถอนสิทธิ์แล้วยิงเส้นทางแอดมินไม่ผ่านทันที
async function verifyUser(idToken) {
  const res = await fetchWithTimeout(
    `${IDTOOLKIT}/accounts:lookup?key=${FIREBASE_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
  const data = await res.json();
  const u = data.users?.[0];
  if (!u) throw new Error("unauthorized");
  if (u.disabled === true) throw new Error("unauthorized");   // บัญชีถูกปิด = โทเคนเดิมใช้ต่อไม่ได้

  let claims = {};
  try {
    const s = u.customAttributes || "{}";
    if (typeof s === "string" && s.length <= 1000) claims = JSON.parse(s) || {};
  } catch { claims = {}; }
  if (typeof claims !== "object" || Array.isArray(claims) || claims === null) claims = {};

  return {
    uid: u.localId,
    email: u.email || "",
    name: u.displayName || "",
    emailVerified: u.emailVerified === true,
    claims,
  };
}

// ---------- Firestore ----------
const fsValue = v =>
  v === null || v === undefined ? { nullValue: null }
  : typeof v === "boolean" ? { booleanValue: v }
  : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : v instanceof Date ? { timestampValue: v.toISOString() }
  : Array.isArray(v) ? { arrayValue: { values: v.map(fsValue) } }
  : typeof v === "object" ? { mapValue: { fields: fsFields(v) } }
  : { stringValue: String(v) };

const fsFields = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fsValue(v)]));

// แปลงค่าจาก Firestore กลับเป็นค่า JS ธรรมดา (ใช้ตอนอ่าน items[] ของออเดอร์)
function fsRead(v) {
  if (!v || typeof v !== "object") return v;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsRead);
  if ("mapValue" in v) return Object.fromEntries(
    Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fsRead(x)]));
  return null;
}

async function commit(token, writes, transaction = null) {
  const res = await fetch(`${DB}:commit`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ writes, ...(transaction ? { transaction } : {}) }),
  });
  const data = await res.json();
  if (data.error) throw Object.assign(new Error(data.error.message), { fsCode: data.error.status });
  return data;
}

// ---------- transaction จริงของ Firestore ----------
// อ่านทุกอย่างในหมายเลข transaction เดียวกัน แล้วค่อย commit ทีเดียว
// ถ้ามีใครแก้เอกสารที่เราอ่านไว้ระหว่างทาง Firestore จะปฏิเสธทั้งชุด
// จำเป็นกับทุกงานที่แตะเครดิต: กดอนุมัติสองหน้าจอพร้อมกันต้องเข้าได้แค่ครั้งเดียว
async function beginTx(token) {
  const res = await fetch(`${DB}:beginTransaction`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ options: { readWrite: {} } }),
  });
  const data = await res.json();
  if (!data.transaction) throw new Error("TX_BEGIN_FAILED");
  return data.transaction;
}

async function rollbackTx(token, transaction) {
  if (!transaction) return;
  await fetch(`${DB}:rollback`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ transaction }),
  }).catch(() => {});
}

const docPath = (col, id) => `projects/${PROJECT_ID}/databases/(default)/documents/${col}/${id}`;

async function getDocFields(token, fullPath) {
  const res = await fetch(`https://firestore.googleapis.com/v1/${fullPath}`,
    { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) return null;
  return (await res.json()).fields || null;
}

// อ่านเอกสารหลายชิ้นพร้อมกัน (ใส่ transaction ได้ ถ้าต้องการอ่านแบบล็อก)
async function batchGet(token, paths, transaction = null) {
  const res = await fetch(`${DB}:batchGet`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      documents: paths.map(p => `projects/${PROJECT_ID}/databases/(default)/${p.replace(/^projects\/[^/]+\/databases\/\(default\)\//, "")}`),
      ...(transaction ? { transaction } : {}),
    }),
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

// ค้นเอกสารในคอลเลกชันย่อย (ใช้หาไอดีในคลังที่ยังไม่ถูกขาย)
async function runQuery(token, parent, structuredQuery, transaction = null) {
  const res = await fetch(`${DB}/${parent}:runQuery`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery, ...(transaction ? { transaction } : {}) }),
  });
  const rows = await res.json();
  if (rows?.error) throw new Error(rows.error.message);
  if (!Array.isArray(rows)) return [];
  return rows.filter(r => r.document)
    .map(r => ({ name: r.document.name, fields: r.document.fields || {} }));
}

const num = f => Number(f?.integerValue ?? f?.doubleValue ?? 0);
const str = f => String(f?.stringValue ?? "");

// ปัดเศษเงินเป็น 2 ตำแหน่ง กัน 19.9 * 3 = 59.699999999999996
const money2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ---------- จำกัดจำนวนครั้งต่อคน ----------
// กันคนยิงลิงก์รัวๆ จนทรูมันนี่บล็อกเซิร์ฟเวอร์เรา
// แอดมินได้โควตาสูงกว่า เพราะกดอนุมัติทีละหลายรายการติดกันเป็นเรื่องปกติ
const RATE_MAX = 8;           // กี่ครั้ง (ลูกค้า)
const RATE_MAX_ADMIN = 120;   // กี่ครั้ง (แอดมิน)
const RATE_WINDOW_MS = 60000; // ต่อกี่มิลลิวินาที

async function rateLimited(token, uid, max = RATE_MAX) {
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

  if (count >= max) return true;

  await commit(token, [{
    update: { name: path, fields: fsFields({ count: count + 1, windowStart, uid }) },
  }]).catch(() => {});
  return false;
}

// รหัสข้อผิดพลาดที่ส่งกลับให้หน้าเว็บได้ (นอกเหนือจากนี้ถือเป็นข้อผิดพลาดภายใน)
const CLIENT_ERRORS = new Set([
  "EMPTY_CART", "TOO_MANY_ITEMS", "BAD_ITEM", "BAD_QTY", "PRODUCT_NOT_FOUND",
  "PRODUCT_INACTIVE", "OUT_OF_STOCK", "BAD_PRICE", "BAD_TOTAL",
  "NO_PROFILE", "NOT_ENOUGH_CREDIT", "NEED_CUSTOMER_INFO",
]);

// รหัสข้อผิดพลาดของเส้นทางแอดมิน (หน้าเว็บแปลเป็นข้อความไทย/อังกฤษเอง)
const ADMIN_ERRORS = new Set([
  "ADMIN_ONLY", "NOT_FOUND", "ALREADY_HANDLED", "MEMBER_NOT_FOUND",
  "INSUFFICIENT_CUSTOMER_CREDIT", "NOT_ENOUGH_STOCK_ITEMS", "STOCK_ITEM_TAKEN",
  "EMPTY_STOCK_ITEM", "OUT_OF_STOCK", "AMOUNT_MISSING", "AMOUNT_INVALID",
  "AMOUNT_TOO_LARGE", "WOULD_GO_NEGATIVE", "CANNOT_CHANGE_SELF", "BAD_REQUEST",
  "CLAIMS_PERMISSION", "CLAIMS_FAILED", "BOOTSTRAP_DISABLED", "BOOTSTRAP_BAD_SECRET",
  "BUSY",
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

// ================= เส้นทางแอดมิน =================

// ---------- ตรวจสิทธิ์แอดมิน 2 ชั้น ----------
// ชั้นที่ 1: custom claim `admin: true` ในบัญชี Firebase Auth
//           ตั้งได้จากเซิร์ฟเวอร์เท่านั้น เบราว์เซอร์ปลอมไม่ได้เพราะเซ็นมากับโทเคน
// ชั้นที่ 2: users/{uid}.role == 'admin' ในฐานข้อมูล
//           เขียนได้จากเซิร์ฟเวอร์เท่านั้นเช่นกัน (กฎปิดทุกคน)
//
// ทำไมต้องสองชั้น: ถอนสิทธิ์แล้วต้องมีผล "ทันที" ทั้งที่นี่และที่ firestore.rules
// โทเคนใบเก่าที่ยังไม่หมดอายุจะมี claim ค้างได้ถึง 1 ชั่วโมง แต่พอเอกสารถูกลดเป็น member
// กฎฝั่ง Firestore ก็ปฏิเสธทันที ส่วนฝั่งนี้อ่าน claim จากบัญชีจริงอยู่แล้ว
async function requireAdmin(token, user) {
  if (user?.claims?.admin !== true) throw new Error("ADMIN_ONLY");
  const got = await batchGet(token, [`documents/users/${user.uid}`]);
  const me = got[user.uid];
  if (!me || str(me.role) !== "admin") throw new Error("ADMIN_ONLY");
  return me;
}

// บันทึกทุกการกระทำของแอดมิน — ลบไม่ได้ แก้ไม่ได้ อ่านได้เฉพาะแอดมิน
function auditWrite(admin, action, detail = {}) {
  // ใช้ UUID เต็ม ไม่ตัดสั้น — ถ้า id ชนกันแม้ครั้งเดียว คำสั่งทั้งชุดจะถูกปฏิเสธ
  // (เขียนด้วยเงื่อนไข "ต้องยังไม่มีเอกสารนี้" เพื่อไม่ให้บันทึกเก่าถูกทับหาย)
  const id = crypto.randomUUID().replace(/-/g, "");
  return {
    update: {
      name: docPath("adminLogs", id),
      fields: fsFields({
        at: new Date(),
        action,
        byUid: admin.uid,
        byEmail: admin.email || "",
        ...detail,
      }),
    },
    currentDocument: { exists: false },
  };
}

// ---------- ตั้ง/ถอด custom claim ----------
async function setAdminClaim(env, uid, on) {
  const authToken = await getAccessToken(env.SA_KEY, SCOPE_AUTH);
  const res = await fetchWithTimeout(`${IDTOOLKIT}/projects/${PROJECT_ID}/accounts:update`, {
    method: "POST",
    headers: { Authorization: "Bearer " + authToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      localId: uid,
      customAttributes: JSON.stringify(on ? { admin: true } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data?.error?.message || ("HTTP " + res.status);
    const denied = /PERMISSION_DENIED|insufficient|IAM|forbidden/i.test(msg) || res.status === 403;
    throw Object.assign(new Error(denied ? "CLAIMS_PERMISSION" : "CLAIMS_FAILED"), { detail: msg });
  }
  return true;
}

// ---------- แอดมิน: ปรับเครดิตให้สมาชิก ----------
// ใส่ค่าติดลบ = หักคืน · บันทึกลงประวัติเติมเงิน (method=admin) + adminLogs
async function adminAdjustCredit(token, admin, { uid, amount, note = "" }) {
  if (!isId(uid)) throw new Error("BAD_REQUEST");
  const amt = money2(amount);
  if (!Number.isFinite(amt) || amt === 0) throw new Error("AMOUNT_INVALID");
  if (Math.abs(amt) > 100000) throw new Error("AMOUNT_TOO_LARGE");
  const memo = String(note ?? "").slice(0, 300);

  const tx = await beginTx(token);
  try {
    const got = await batchGet(token, [`documents/users/${uid}`], tx);
    const u = got[uid];
    if (!u) throw new Error("MEMBER_NOT_FOUND");

    const before = money2(num(u.credit));
    const after = money2(before + amt);
    if (after < 0) throw new Error("WOULD_GO_NEGATIVE");

    const logId = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    await commit(token, [
      {
        update: { name: docPath("users", uid), fields: fsFields({ credit: after }) },
        updateMask: { fieldPaths: ["credit"] },
      },
      {
        update: {
          name: docPath("topups", logId),
          fields: fsFields({
            uid,
            name: str(u.name),
            email: str(u.email),
            amount: amt,
            method: "admin",
            note: memo,
            status: "approved",
            createdAt: new Date(),
            approvedAt: new Date(),
            approvedBy: admin.email || "",
          }),
        },
        currentDocument: { exists: false },
      },
      auditWrite(admin, "credit.adjust",
        { targetUid: uid, amount: amt, before, after, note: memo }),
    ], tx);
    return { logId, before, after };
  } catch (e) {
    await rollbackTx(token, tx);
    throw e;
  }
}

// ---------- แอดมิน: อนุมัติเติมเงิน ----------
// amountOverride ใช้กับรายการที่บอทบันทึกยอดไม่ทัน (amount = 0)
// ถ้าไม่บังคับให้ใส่ยอด แอดมินจะกดอนุมัติแล้วเครดิตเข้า 0 บาทแบบเงียบๆ
const OPEN_TOPUP = ["pending", "processing"];

async function adminApproveTopup(token, admin, { topupId, amount = null }) {
  if (!isId(topupId)) throw new Error("BAD_REQUEST");

  const tx = await beginTx(token);
  try {
    const got = await batchGet(token, [`documents/topups/${topupId}`], tx);
    const tp = got[topupId];
    if (!tp) throw new Error("NOT_FOUND");
    if (!OPEN_TOPUP.includes(str(tp.status))) throw new Error("ALREADY_HANDLED");

    const amt = money2(amount === null || amount === undefined || amount === "" ? num(tp.amount) : amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("AMOUNT_MISSING");
    if (amt > 100000) throw new Error("AMOUNT_TOO_LARGE");

    const uid = str(tp.uid);
    if (!uid) throw new Error("MEMBER_NOT_FOUND");
    const uGot = await batchGet(token, [`documents/users/${uid}`], tx);
    const u = uGot[uid];
    if (!u) throw new Error("MEMBER_NOT_FOUND");

    const before = money2(num(u.credit));
    const after = money2(before + amt);

    await commit(token, [
      {
        update: { name: docPath("users", uid), fields: fsFields({ credit: after }) },
        updateMask: { fieldPaths: ["credit"] },
      },
      {
        update: {
          name: docPath("topups", topupId),
          fields: fsFields({
            amount: amt,
            status: "approved",
            approvedAt: new Date(),
            approvedBy: admin.email || "",
          }),
        },
        updateMask: { fieldPaths: ["amount", "status", "approvedAt", "approvedBy"] },
      },
      auditWrite(admin, "topup.approve",
        { topupId, targetUid: uid, amount: amt, before, after }),
    ], tx);
    return { amount: amt, before, after };
  } catch (e) {
    await rollbackTx(token, tx);
    throw e;
  }
}

// ---------- แอดมิน: ไม่อนุมัติเติมเงิน ----------
// เช็คสถานะในtransaction กัน "ไม่อนุมัติ" ทับรายการที่เติมเครดิตไปแล้ว
async function adminRejectTopup(token, admin, { topupId, note = "" }) {
  if (!isId(topupId)) throw new Error("BAD_REQUEST");
  const memo = String(note ?? "").slice(0, 300);

  const tx = await beginTx(token);
  try {
    const got = await batchGet(token, [`documents/topups/${topupId}`], tx);
    const tp = got[topupId];
    if (!tp) throw new Error("NOT_FOUND");
    if (!OPEN_TOPUP.includes(str(tp.status))) throw new Error("ALREADY_HANDLED");

    await commit(token, [
      {
        update: {
          name: docPath("topups", topupId),
          fields: fsFields({
            status: "rejected",
            note: memo,
            approvedAt: new Date(),
            approvedBy: admin.email || "",
          }),
        },
        updateMask: { fieldPaths: ["status", "note", "approvedAt", "approvedBy"] },
      },
      auditWrite(admin, "topup.reject", { topupId, targetUid: str(tp.uid), note: memo }),
    ], tx);
    return { ok: true };
  } catch (e) {
    await rollbackTx(token, tx);
    throw e;
  }
}

// ---------- แอดมิน: อนุมัติออเดอร์ ----------
// หักเครดิต + ตัดสต๊อก + จับไอดีในคลังส่งให้ลูกค้า + เปลี่ยนสถานะ ในชุดเดียว
// ถ้าขั้นใดพลาด จะไม่เกิดอะไรขึ้นเลยสักอย่าง
async function adminApproveOrder(token, admin, { orderId }) {
  if (!isId(orderId)) throw new Error("BAD_REQUEST");

  const tx = await beginTx(token);
  try {
    const got = await batchGet(token, [`documents/orders/${orderId}`], tx);
    const o = got[orderId];
    if (!o) throw new Error("NOT_FOUND");
    if (str(o.status) !== "pending") throw new Error("ALREADY_HANDLED");

    const uid = str(o.uid);
    const total = money2(num(o.total));
    const items = (fsRead(o.items) || []).map(i => ({ ...i }));
    if (!uid || !items.length) throw new Error("BAD_REQUEST");

    // ---- อ่านให้ครบก่อน ----
    const uGot = await batchGet(token, [`documents/users/${uid}`], tx);
    const u = uGot[uid];
    if (!u) throw new Error("MEMBER_NOT_FOUND");
    const before = money2(num(u.credit));
    if (before < total) throw new Error("INSUFFICIENT_CUSTOMER_CREDIT");

    const wanted = new Map();
    for (const i of items) {
      const pid = String(i.id || "");
      if (!isId(pid)) throw new Error("BAD_REQUEST");
      wanted.set(pid, (wanted.get(pid) || 0) + Math.floor(Number(i.qty || 0)));
    }

    const products = await batchGet(token,
      [...wanted.keys()].map(pid => `documents/products/${pid}`), tx);

    // จองไอดีในคลังของสินค้าดิจิทัล (อ่านในtransaction = ใครมาแย่งระหว่างนี้ไม่ได้)
    const picked = {};
    for (const [pid, qty] of wanted) {
      const p = products[pid];
      if (!p || p.digital?.booleanValue !== true) continue;
      const found = await runQuery(token, `products/${pid}`, {
        from: [{ collectionId: "stockItems" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "EQUAL",
            value: { stringValue: "available" },
          },
        },
        limit: qty,
      }, tx);
      if (found.length < qty) throw new Error("NOT_ENOUGH_STOCK_ITEMS");
      // ห้ามส่งของว่างเปล่าให้ลูกค้าเด็ดขาด ให้แอดมินไปกรอกข้อมูลก่อน
      for (const r of found) {
        if (!str(r.fields.login).trim() && !str(r.fields.password).trim()) {
          throw new Error("EMPTY_STOCK_ITEM");
        }
      }
      picked[pid] = found;
    }

    // ---- ตรวจเสร็จแล้วค่อยเขียน ----
    const writes = [];

    // ตัดสต๊อก (เฉพาะสินค้าที่กำหนดจำนวนไว้ ของที่ปล่อยว่าง = ไม่จำกัด)
    for (const [pid, qty] of wanted) {
      const p = products[pid];
      if (!p) continue;
      const hasStock = p.stock && p.stock.nullValue === undefined;
      if (!hasStock) continue;
      const left = num(p.stock) - qty;
      if (left < 0) throw new Error("OUT_OF_STOCK");
      writes.push({
        update: { name: docPath("products", pid), fields: fsFields({ stock: left }) },
        updateMask: { fieldPaths: ["stock"] },
      });
    }

    // จับไอดีใส่ออเดอร์ + ตัดชิ้นนั้นออกจากคลัง
    const queue = Object.fromEntries(Object.entries(picked).map(([pid, arr]) => [pid, [...arr]]));
    const newItems = items.map(i => {
      const pid = String(i.id);
      if (!queue[pid]) return i;
      const take = queue[pid].splice(0, Math.floor(Number(i.qty || 0)));
      if (take.length < Math.floor(Number(i.qty || 0))) throw new Error("STOCK_ITEM_TAKEN");
      return {
        ...i,
        delivered: take.map(r => ({
          login: str(r.fields.login),
          password: str(r.fields.password),
          note: str(r.fields.note),
        })),
      };
    });

    for (const [pid, arr] of Object.entries(picked)) {
      for (const r of arr) {
        writes.push({
          update: {
            name: r.name,
            fields: fsFields({ status: "sold", orderId, uid, soldAt: new Date() }),
          },
          updateMask: { fieldPaths: ["status", "orderId", "uid", "soldAt"] },
        });
      }
    }

    const after = money2(before - total);
    writes.push({
      update: { name: docPath("users", uid), fields: fsFields({ credit: after }) },
      updateMask: { fieldPaths: ["credit"] },
    });
    writes.push({
      update: {
        name: docPath("orders", orderId),
        fields: fsFields({
          items: newItems,
          status: "approved",
          approvedAt: new Date(),
          approvedBy: admin.email || "",
        }),
      },
      updateMask: { fieldPaths: ["items", "status", "approvedAt", "approvedBy"] },
    });
    writes.push(auditWrite(admin, "order.approve",
      { orderId, targetUid: uid, amount: total, before, after }));

    await commit(token, writes, tx);
    return { total, before, after };
  } catch (e) {
    await rollbackTx(token, tx);
    throw e;
  }
}

// ---------- แอดมิน: ไม่อนุมัติออเดอร์ ----------
async function adminRejectOrder(token, admin, { orderId, note = "" }) {
  if (!isId(orderId)) throw new Error("BAD_REQUEST");
  const memo = String(note ?? "").slice(0, 300);

  const tx = await beginTx(token);
  try {
    const got = await batchGet(token, [`documents/orders/${orderId}`], tx);
    const o = got[orderId];
    if (!o) throw new Error("NOT_FOUND");
    if (str(o.status) !== "pending") throw new Error("ALREADY_HANDLED");

    await commit(token, [
      {
        update: {
          name: docPath("orders", orderId),
          fields: fsFields({
            status: "rejected",
            note: memo,
            approvedAt: new Date(),
            approvedBy: admin.email || "",
          }),
        },
        updateMask: { fieldPaths: ["status", "note", "approvedAt", "approvedBy"] },
      },
      auditWrite(admin, "order.reject", { orderId, targetUid: str(o.uid), note: memo }),
    ], tx);
    return { ok: true };
  } catch (e) {
    await rollbackTx(token, tx);
    throw e;
  }
}

// ---------- แอดมิน: ลบชื่อผู้ใช้/รหัสผ่านของลูกค้าออกจากออเดอร์ ----------
// ใช้หลังเติมเกมให้เสร็จแล้ว — ไอดีเกม/UID ยังเก็บไว้เป็นหลักฐานว่าเติมให้ใคร
async function adminClearOrderInfo(token, admin, { orderId }) {
  if (!isId(orderId)) throw new Error("BAD_REQUEST");

  const tx = await beginTx(token);
  try {
    const got = await batchGet(token, [`documents/orders/${orderId}`], tx);
    const o = got[orderId];
    if (!o) throw new Error("NOT_FOUND");

    const items = (fsRead(o.items) || []).map(({ gameLogin, gamePassword, ...keep }) => keep);
    await commit(token, [
      {
        update: {
          name: docPath("orders", orderId),
          fields: fsFields({ items, customerInfoClearedAt: new Date() }),
        },
        updateMask: { fieldPaths: ["items", "customerInfoClearedAt"] },
      },
      auditWrite(admin, "order.clearInfo", { orderId, targetUid: str(o.uid) }),
    ], tx);
    return { ok: true };
  } catch (e) {
    await rollbackTx(token, tx);
    throw e;
  }
}

// ---------- แอดมิน: ตั้ง/ถอดสิทธิ์แอดมิน ----------
// ตั้ง: ใส่ claim ก่อน แล้วค่อยเขียนเอกสาร — ถ้าพลาดกลางทางจะยัง "ไม่ได้สิทธิ์"
// ถอน: ลดเอกสารเป็น member ก่อน แล้วค่อยล้าง claim — ถ้าพลาดกลางทางก็ "หมดสิทธิ์" แล้ว
// ทั้งสองทางเลือกให้พลาดแล้วปลอดภัยไว้ก่อนเสมอ (fail closed)
async function adminSetRole(token, env, admin, { uid, makeAdmin }) {
  if (!isId(uid)) throw new Error("BAD_REQUEST");
  if (typeof makeAdmin !== "boolean") throw new Error("BAD_REQUEST");
  // ถอดสิทธิ์ตัวเองไม่ได้ กันเผลอจนไม่เหลือแอดมินสักคน
  if (uid === admin.uid) throw new Error("CANNOT_CHANGE_SELF");

  const got = await batchGet(token, [`documents/users/${uid}`]);
  const target = got[uid];
  if (!target) throw new Error("MEMBER_NOT_FOUND");

  if (makeAdmin) {
    await setAdminClaim(env, uid, true);
    await commit(token, [
      {
        update: { name: docPath("users", uid), fields: fsFields({ role: "admin" }) },
        updateMask: { fieldPaths: ["role"] },
      },
      auditWrite(admin, "role.grant", { targetUid: uid, targetEmail: str(target.email) }),
    ]);
  } else {
    await commit(token, [
      {
        update: { name: docPath("users", uid), fields: fsFields({ role: "member" }) },
        updateMask: { fieldPaths: ["role"] },
      },
      auditWrite(admin, "role.revoke", { targetUid: uid, targetEmail: str(target.email) }),
    ]);
    await setAdminClaim(env, uid, false);
  }
  return { uid, admin: makeAdmin };
}

// ---------- ตั้งแอดมินคนแรก / กู้คืนสิทธิ์ ----------
// ใช้รหัสลับ ADMIN_BOOTSTRAP ที่ตั้งไว้ใน Cloudflare (ไม่มีในโค้ด ไม่มีในเว็บ)
// จำเป็นเพราะถ้าไม่มีแอดมินสักคน จะไม่มีใครตั้งแอดมินคนแรกได้เลย
async function adminBootstrap(token, env, user, { secret }) {
  const want = String(env.ADMIN_BOOTSTRAP || "");
  if (want.length < 16) throw new Error("BOOTSTRAP_DISABLED");
  if (!safeEqual(secret, want)) throw new Error("BOOTSTRAP_BAD_SECRET");

  const got = await batchGet(token, [`documents/users/${user.uid}`]);
  if (!got[user.uid]) throw new Error("NO_PROFILE");

  await setAdminClaim(env, user.uid, true);
  await commit(token, [
    {
      update: { name: docPath("users", user.uid), fields: fsFields({ role: "admin" }) },
      updateMask: { fieldPaths: ["role"] },
    },
    auditWrite({ uid: user.uid, email: user.email }, "role.bootstrap",
      { targetUid: user.uid, targetEmail: user.email || "" }),
  ]);
  return { uid: user.uid, admin: true };
}

// ---------- ตรวจสภาพเซิร์ฟเวอร์ (ใช้ตอนติดตั้ง/แก้ปัญหา) ----------
// ต้องรู้รหัสลับเดียวกับ /admin/bootstrap ถึงจะเรียกได้
// บอกว่า service account ตัวไหน และตอนนี้ตั้ง custom claim ได้หรือยัง
async function adminDiagnose(env, user, { secret }) {
  const want = String(env.ADMIN_BOOTSTRAP || "");
  if (want.length < 16) throw new Error("BOOTSTRAP_DISABLED");
  if (!safeEqual(secret, want)) throw new Error("BOOTSTRAP_BAD_SECRET");

  let serviceAccount = "";
  try { serviceAccount = JSON.parse(env.SA_KEY).client_email || ""; } catch { serviceAccount = "อ่านค่า SA_KEY ไม่ได้"; }

  // ทดสอบสิทธิ์ตั้ง claim ด้วยการเขียนค่าเดิมทับตัวเอง (ไม่เปลี่ยนอะไร)
  let claimsOk = false, detail = "";
  try {
    const authToken = await getAccessToken(env.SA_KEY, SCOPE_AUTH);
    const res = await fetchWithTimeout(`${IDTOOLKIT}/projects/${PROJECT_ID}/accounts:update`, {
      method: "POST",
      headers: { Authorization: "Bearer " + authToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        localId: user.uid,
        customAttributes: JSON.stringify(user.claims || {}),
      }),
    });
    const d = await res.json().catch(() => ({}));
    claimsOk = res.ok && !d.error;
    if (!claimsOk) detail = (d?.error?.message || ("HTTP " + res.status)).slice(0, 200);
  } catch (e) { detail = String(e.message).slice(0, 200); }

  return { projectId: PROJECT_ID, serviceAccount, claimsOk, detail };
}

// ---------- ตัวช่วยตรวจสถานะของตัวเอง ----------
// หน้าเว็บเรียกเพื่อดูว่าตกลงตอนนี้เป็นแอดมินจริงไหม (claim + เอกสาร ตรงกันหรือยัง)
async function adminWhoAmI(token, user) {
  const got = await batchGet(token, [`documents/users/${user.uid}`]).catch(() => ({}));
  const me = got[user.uid];
  const claim = user?.claims?.admin === true;
  const role = me ? str(me.role) : "";
  return { uid: user.uid, claim, role, admin: claim && role === "admin" };
}

// เส้นทางแอดมินทั้งหมด
async function adminRoute(path, body, token, env, user) {
  // /admin/bootstrap ไม่ต้องเป็นแอดมินก่อน (ใช้ตอนยังไม่มีแอดมินเลย) แต่ต้องมีรหัสลับ
  if (path === "/admin/bootstrap") return adminBootstrap(token, env, user, body);
  if (path === "/admin/whoami") return adminWhoAmI(token, user);
  if (path === "/admin/diagnose") return adminDiagnose(env, user, body);

  const admin = await requireAdmin(token, user);
  const me = { uid: user.uid, email: user.email || str(admin.email) };

  switch (path) {
    case "/admin/credit":            return adminAdjustCredit(token, me, body);
    case "/admin/topup/approve":     return adminApproveTopup(token, me, body);
    case "/admin/topup/reject":      return adminRejectTopup(token, me, body);
    case "/admin/order/approve":     return adminApproveOrder(token, me, body);
    case "/admin/order/reject":      return adminRejectOrder(token, me, body);
    case "/admin/order/clear-info":  return adminClearOrderInfo(token, me, body);
    case "/admin/role":              return adminSetRole(token, env, me, body);
    default: throw new Error("NOT_FOUND");
  }
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
export {
  parseAngpaoCode, getAccessToken, commit, docPath, fsFields, fsValue, fsRead,
  redeemAngpao, createOrder, batchGet, money2, safeEqual, requireAdmin,
  adminAdjustCredit, adminApproveTopup, adminApproveOrder, adminSetRole,
};

// ---------- main ----------
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: "BAD_ORIGIN" }, 403, origin);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: "BAD_JSON" }, 400, origin); }
    if (!body || typeof body !== "object") return json({ ok: false, error: "BAD_JSON" }, 400, origin);

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

    // โควตาต่อคน — แอดมินกดอนุมัติติดกันหลายรายการได้ ลูกค้าจำกัดแน่นกว่า
    const cap = user.claims?.admin === true ? RATE_MAX_ADMIN : RATE_MAX;
    if (await rateLimited(token, user.uid, cap)) {
      return json({ ok: false, error: "RATE_LIMITED" }, 429, origin);
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

    // ===== เส้นทางแอดมิน =====
    if (path.startsWith("/admin/")) {
      try {
        const r = await adminRoute(path, body, token, env, user);
        return json({ ok: true, ...r }, 200, origin);
      } catch (e) {
        // Firestore ปฏิเสธเพราะมีคนแก้เอกสารเดียวกันพร้อมกัน = ให้กดใหม่ ไม่ใช่ข้อผิดพลาดของระบบ
        const busy = e.fsCode === "ABORTED" || /ABORTED|contention|too much contention/i.test(e.message || "");
        const code = ADMIN_ERRORS.has(e.message) ? e.message : (busy ? "BUSY" : "ADMIN_FAILED");
        if (code === "ADMIN_FAILED") console.error("adminRoute " + path, e);
        if (code === "CLAIMS_PERMISSION") console.error("ตั้ง custom claim ไม่ได้:", e.detail || e.message);
        const status = code === "ADMIN_ONLY" ? 403 : code === "ADMIN_FAILED" ? 500 : 400;
        return json({ ok: false, error: code }, status, origin);
      }
    }

    // ===== เส้นทางสั่งซื้อ =====
    if (path === "/order") {
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
