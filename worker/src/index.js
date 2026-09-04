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

  const res = await fetch("https://oauth2.googleapis.com/token", {
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
  const res = await fetch(
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

// ---------- กดรับซองอั่งเปา ----------
async function redeemAngpao(code, phone) {
  const res = await fetch(`https://gift.truemoney.com/campaign/vouchers/${code}/redeem`, {
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
export { parseAngpaoCode, getAccessToken, commit, docPath, fsFields, fsValue, redeemAngpao };

// ---------- main ----------
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: "BAD_ORIGIN" }, 403, origin);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: "BAD_JSON" }, 400, origin); }

    const code = parseAngpaoCode(body.link);
    if (!code) return json({ ok: false, error: "INVALID_LINK" }, 400, origin);

    // 1) ผู้เรียกต้องเป็นสมาชิกที่ล็อกอินจริง
    let user;
    try { user = await verifyUser(body.idToken); }
    catch { return json({ ok: false, error: "UNAUTHORIZED" }, 401, origin); }

    const token = await getAccessToken(env.SA_KEY);

    // 2) จำกัดจำนวนครั้ง กันการยิงรัว
    if (await rateLimited(token, user.uid)) {
      return json({ ok: false, error: "RATE_LIMITED" }, 429, origin);
    }

    const phone = env.RECEIVE_PHONE;
    const topupDoc = docPath("topups", "angpao_" + code);

    // 3) จองรหัสซองนี้ไว้ก่อน — ถ้ามีคนใช้ไปแล้วจะเขียนไม่สำเร็จ (กันใช้ซ้ำ/ยิงพร้อมกัน)
    try {
      await commit(token, [{
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
    await commit(token, [
      {
        update: {
          name: topupDoc,
          fields: fsFields({
            amount: result.amount, status: "approved",
            approvedAt: new Date(), approvedBy: "angpao-bot",
          }),
        },
        updateMask: { fieldPaths: ["amount", "status", "approvedAt", "approvedBy"] },
      },
      {
        transform: {
          document: docPath("users", user.uid),
          fieldTransforms: [{ fieldPath: "credit", increment: fsValue(result.amount) }],
        },
      },
    ]);

    return json({ ok: true, amount: result.amount }, 200, origin);
  },
};
