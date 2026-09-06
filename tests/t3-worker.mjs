// ===== ทดสอบเซิร์ฟเวอร์ (Cloudflare Worker) ด้วย fetch จำลอง =====
import fs from "fs";
const SRC = "../worker/src/index.js";
fs.mkdirSync("./sandbox", { recursive: true });
fs.writeFileSync("./sandbox/worker.mjs", fs.readFileSync(SRC, "utf8"));

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");

// ---------- Firestore REST จำลอง ----------
const DOCS = new Map();
let updateSeq = 1;
const times = new Map();
const P = "projects/qqshop-ecc92/databases/(default)/documents/";
const short = full => full.split("/documents/")[1];

const V = v => v === null ? { nullValue: null }
  : typeof v === "boolean" ? { booleanValue: v }
  : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : { stringValue: String(v) };
const F = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, V(v)]));

export let TM = { status: { code: "SUCCESS" }, data: { my_ticket: { amount_baht: 50 } } };

// ระบบสมาชิกจำลอง: custom claim ของแต่ละ uid + สวิตช์จำลองปัญหา
const CLAIMS = new Map();
const DISABLED = new Set();
let CLAIMS_DENIED = false;      // จำลอง service account ไม่มีสิทธิ์ตั้ง claim
let txSeq = 0;
let FAIL_COMMIT = 0;
// ให้คำสั่งเขียนที่แตะเอกสารนี้พังหนึ่งครั้ง (เจาะจงกว่าการนับจำนวนครั้ง
// เพราะระหว่างทางมีคำสั่งเขียนของตัวนับ rate limit แทรกอยู่ด้วย)
let FAIL_COMMIT_PATH = null;
const failCommitFor = p => { FAIL_COMMIT_PATH = p; };
// จำลองการแข่งกัน: มีคนลบเอกสารทิ้งทันทีหลังเซิร์ฟเวอร์อ่านค่าไปแล้ว
let DELETE_AFTER_READ = null;
const deleteAfterRead = p => { DELETE_AFTER_READ = p; };

globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  const body = opt.body && typeof opt.body === "string" && opt.body.startsWith("{") ? JSON.parse(opt.body) : null;
  const J = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });

  if (url.includes("oauth2.googleapis.com/token")) return J({ access_token: "tok", expires_in: 3600 });
  if (url.includes("identitytoolkit")) {
    // เส้นทางที่ต้องใช้สิทธิ์ของ service account (/v1/projects/<id>/accounts:...)
    // ต่างจากเส้นทางตรวจโทเคนของผู้เรียก ซึ่งใช้ API key สาธารณะ
    const isAdminOp = url.includes("/projects/");
    if (isAdminOp && CLAIMS_DENIED) {
      return J({ error: { message: "PERMISSION_DENIED: missing firebaseauth.users.update" } }, 403);
    }
    // ตั้ง custom claim (เหมือน Admin SDK setCustomUserClaims)
    if (url.includes("accounts:update")) {
      CLAIMS.set(body.localId, JSON.parse(body.customAttributes || "{}"));
      return J({ localId: body.localId });
    }
    // อ่านบัญชีด้วยสิทธิ์ service account (ใช้ตอนตรวจสภาพเซิร์ฟเวอร์)
    if (isAdminOp && url.includes("accounts:lookup")) {
      const target = body.localId?.[0] || "";
      return J({ users: [{ localId: target, email: "c@x.com",
        customAttributes: JSON.stringify(CLAIMS.get(target) || {}) }] });
    }
    if (body?.idToken === "bad") return J({});
    const uid = String(body.idToken).replace("token:", "");
    return J({ users: [{
      localId: uid, email: "c@x.com", displayName: "ลูกค้า",
      disabled: DISABLED.has(uid),
      customAttributes: JSON.stringify(CLAIMS.get(uid) || {}),
    }] });
  }
  if (url.includes(":beginTransaction")) return J({ transaction: "tx" + (++txSeq) });
  if (url.includes(":rollback")) return J({});
  if (url.includes(":runQuery")) {
    // ค้นคลังสินค้าของสินค้าชิ้นหนึ่ง (ใช้ตอนอนุมัติออเดอร์)
    const parent = short(url.split(":runQuery")[0]);          // products/<id>
    const q = body.structuredQuery || {};
    const col = q.from?.[0]?.collectionId || "";
    const want = q.where?.fieldFilter?.value?.stringValue;
    const field = q.where?.fieldFilter?.field?.fieldPath;
    let rows = [...DOCS.entries()]
      .filter(([k]) => k.startsWith(parent + "/" + col + "/"))
      .filter(([, v]) => !field || (v[field]?.stringValue ?? null) === want)
      .sort((a, b) => a[0].localeCompare(b[0]));
    if (q.limit) rows = rows.slice(0, q.limit);
    return J(rows.map(([k, v]) => ({ document: { name: P + k, fields: v } })));
  }
  if (url.includes(":batchGet")) {
    const out = J(body.documents.map(d => {
      const key = short(d);
      return DOCS.has(key) ? { found: { name: P + key, fields: DOCS.get(key) } } : { missing: P + key };
    }));
    // จำลอง "มีคนลบเอกสารทิ้งทันทีหลังเราอ่านไปแล้ว" — โค้ดที่ไม่กันไว้จะเขียนซากเอกสารกลับเข้าไป
    if (DELETE_AFTER_READ && body.documents.some(d => short(d) === DELETE_AFTER_READ)) {
      DOCS.delete(DELETE_AFTER_READ);
      DELETE_AFTER_READ = null;
    }
    return out;
  }
  if (url.includes(":commit")) {
    if (FAIL_COMMIT > 0) { FAIL_COMMIT--; return J({ error: { message: "boom", status: "UNAVAILABLE" } }); }
    if (FAIL_COMMIT_PATH && JSON.stringify(body).includes(FAIL_COMMIT_PATH)) {
      FAIL_COMMIT_PATH = null;
      return J({ error: { message: "boom", status: "UNAVAILABLE" } });
    }
    const results = [];
    for (const w of body.writes) {
      if (w.delete) { DOCS.delete(short(w.delete)); results.push({}); continue; }
      if (w.transform) {
        const k = short(w.transform.document);
        const cur = DOCS.get(k) || {};
        for (const tr of w.transform.fieldTransforms) {
          const add = Number(tr.increment.integerValue ?? tr.increment.doubleValue ?? 0);
          const prev = Number(cur[tr.fieldPath]?.integerValue ?? cur[tr.fieldPath]?.doubleValue ?? 0);
          cur[tr.fieldPath] = V(prev + add);
        }
        DOCS.set(k, cur); results.push({});
        continue;
      }
      const key = short(w.update.name);
      const pre = w.currentDocument;
      if (pre?.exists === false && DOCS.has(key)) return J({ error: { message: "exists", status: "FAILED_PRECONDITION" } });
      // Firestore ปฏิเสธเมื่อสั่ง "ต้องมีอยู่แล้ว" แต่เอกสารถูกลบไปก่อน
      // (ถ้าไม่มีเงื่อนไขนี้ คำสั่ง update จะสร้างเอกสารใหม่ให้เงียบๆ)
      if (pre?.exists === true && !DOCS.has(key)) return J({ error: { message: "missing", status: "FAILED_PRECONDITION" } });
      if (pre?.updateTime && times.get(key) !== pre.updateTime) {
        return J({ error: { message: "stale", status: "FAILED_PRECONDITION" } });
      }
      const mask = w.updateMask?.fieldPaths;
      const cur = mask ? (DOCS.get(key) || {}) : {};
      DOCS.set(key, { ...cur, ...w.update.fields });
      const ut = "t" + (updateSeq++);
      times.set(key, ut);
      results.push({ updateTime: ut });
    }
    return J({ writeResults: results });
  }
  if (url.includes("gift.truemoney.com")) return J(TM, TM.status.code === "SUCCESS" ? 200 : 400);
  const k2 = url.split("/documents/")[1];
  if (k2) return DOCS.has(k2) ? J({ fields: DOCS.get(k2) }) : J({}, 404);
  return J({}, 404);
};

Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: {
    subtle: { importKey: async () => ({}), sign: async () => new Uint8Array([1, 2, 3]) },
    // ตัวนับต้องอยู่ต้นสตริง เพราะโค้ดจริงตัดเอาเฉพาะ 20 ตัวแรกมาใช้เป็นรหัสออเดอร์
    randomUUID: () => String(updateSeq++).padStart(8, "0") + "-bbbb-cccc-dddd-eeeeeeeeeeee",
  },
});

const W = (await import("./sandbox/worker.mjs")).default;
const ORIGIN = "https://908wayu-svg.github.io";
const env = {
  SA_KEY: JSON.stringify({ client_email: "x@y", private_key: "" }),
  RECEIVE_PHONE: "0918200409",
  ADMIN_BOOTSTRAP: "ความลับตั้งแอดมินคนแรก-1234567890",
};
const setClaim = (uid, c) => CLAIMS.set(uid, c);
const claimOf = uid => CLAIMS.get(uid) || {};
const denyClaims = v => { CLAIMS_DENIED = v; };
const call = async (path, payload, origin = ORIGIN) => {
  const res = await W.fetch(new Request("https://bot.workers.dev" + path, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }), env);
  return { status: res.status, body: await res.json(), headers: res.headers };
};

let uidSeq = 0;
const freshUid = () => "u" + (++uidSeq);      // เลี่ยงตัวนับ rate limit ค้างจากเทสก่อนหน้า

function resetDb() {
  DOCS.clear(); times.clear();
  DOCS.set("products/p1", F({ name: "ไอดีเกม A", price: 300, stock: 5, active: true, digital: true }));
  DOCS.set("products/p2", F({ name: "ของไม่จำกัด", price: 20, active: true }));
  DOCS.set("products/p3", F({ name: "ปิดขาย", price: 50, stock: 9, active: false }));
  DOCS.set("products/p4", F({ name: "ราคายังไม่ตั้ง", price: 0, stock: 9, active: true }));
  // ของเติมเกม — แอดมินติ๊กว่าต้องขอข้อมูลไอดีจากลูกค้า
  DOCS.set("products/pUid", F({ name: "เพชร 100 เม็ด", price: 50, active: true, askUid: true }));
  DOCS.set("products/pLogin", F({ name: "เติมเข้าไอดีลูกค้า", price: 80, active: true, askLogin: true }));
}
const withUser = (uid, credit = 1000) => DOCS.set("users/" + uid, F({ name: "ลูกค้า", email: "c@x.com", credit }));
// เติมไอดีลงคลังของสินค้าดิจิทัล — ตอนนี้ /order จ่ายของให้ทันที ถ้าคลังว่างจะสั่งไม่ผ่าน
const withStock = (pid, n = 5) => {
  for (let i = 1; i <= n; i++) {
    DOCS.set("products/" + pid + "/stockItems/k" + i,
      F({ login: "acc" + i, password: "pw" + i, note: "", status: "available" }));
  }
};

section("ความปลอดภัยพื้นฐาน");
resetDb();
ok("โดเมนแปลกปลอมถูกปฏิเสธ", (await call("/order", { idToken: "token:x", items: [] }, "https://evil.com")).body.error === "BAD_ORIGIN");
ok("ไม่ได้ล็อกอิน = ปฏิเสธ", (await call("/order", { idToken: "bad", items: [] })).body.error === "UNAUTHORIZED");
const opt = await W.fetch(new Request("https://b.dev/order", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env);
ok("OPTIONS ตอบ CORS ได้", opt.headers.get("Access-Control-Allow-Origin") === ORIGIN);
const g = await W.fetch(new Request("https://b.dev/order", { method: "GET", headers: { Origin: ORIGIN } }), env);
ok("GET ถูกปฏิเสธ", g.status === 405);
const nonjson = await W.fetch(new Request("https://b.dev/order", { method: "POST", headers: { Origin: ORIGIN }, body: "ไม่ใช่ json" }), env);
ok("body ที่ไม่ใช่ JSON ไม่ทำให้ล่ม", (await nonjson.json()).error === "BAD_JSON");

section("สั่งซื้อ — ราคาคิดจากฐานข้อมูล + หักเครดิตทันที");
resetDb(); withStock("p1");
let u = freshUid(); withUser(u);
let r = await call("/order", { idToken: "token:" + u, items: [{ id: "p1", qty: 2, price: 1, name: "ของถูก" }] });
ok("สั่งซื้อสำเร็จ", r.body.ok === true, JSON.stringify(r.body));
ok("ยอดคิดจากราคาจริง ไม่ใช่ราคาที่ส่งมา", r.body.total === 600, "ได้ " + r.body.total);
const oKey = [...DOCS.keys()].find(k => k.startsWith("orders/"));
ok("บันทึกออเดอร์ลงฐานข้อมูล", !!oKey);
ok("ไอดีเกมจบในตัว สถานะเป็น completed", DOCS.get(oKey).status.stringValue === "completed",
  DOCS.get(oKey).status.stringValue);
ok("ชื่อสินค้าเอามาจากฐานข้อมูล", DOCS.get(oKey).items.arrayValue.values[0].mapValue.fields.name.stringValue === "ไอดีเกม A");
ok("หักเครดิตทันทีตอนสั่ง", Number(DOCS.get("users/" + u).credit.integerValue ?? DOCS.get("users/" + u).credit.doubleValue) === 400,
  JSON.stringify(DOCS.get("users/" + u).credit));
ok("ทำเครื่องหมายว่าหักเครดิตแล้ว (paid)", DOCS.get(oKey).paid.booleanValue === true);
{
  const d = DOCS.get(oKey).items.arrayValue.values[0].mapValue.fields.delivered;
  ok("ส่งมอบไอดีให้ลูกค้าทันที 2 ชุด", !!d && d.arrayValue.values.length === 2);
  ok("ไอดีที่ส่งมีรหัสผ่านจริง",
    String(d.arrayValue.values[0].mapValue.fields.password.stringValue || "").length > 0);
  ok("ตัดสต๊อกทันที", Number(DOCS.get("products/p1").stock.integerValue) === 3,
    JSON.stringify(DOCS.get("products/p1").stock));
  ok("ชิ้นในคลังถูกทำเครื่องหมายว่าขายแล้ว",
    DOCS.get("products/p1/stockItems/k1").status.stringValue === "sold");
  ok("เริ่มจับเวลาเคลมทันที (ไอดีเกม)", !!DOCS.get(oKey).claimTimerStartedAt);
}

// ของเติมเกม — หักเครดิตเหมือนกัน แต่ต้องรอแอดมินทำให้
resetDb(); u = freshUid(); withUser(u);
r = await call("/order", { idToken: "token:" + u, items: [{ id: "pUid", qty: 1, gameUid: "555" }] });
{
  const k = [...DOCS.keys()].find(x => x.startsWith("orders/"));
  ok("ของเติมเกมสถานะเป็น pending", DOCS.get(k).status.stringValue === "pending", JSON.stringify(r.body));
  ok("ของเติมเกมก็หักเครดิตทันที", Number(DOCS.get("users/" + u).credit.integerValue) === 950);
  ok("ยังไม่เริ่มจับเวลาเคลม (รอแอดมินทำเสร็จก่อน)", !DOCS.get(k).claimTimerStartedAt);
}

// สินค้าดิจิทัลที่ไม่มีไอดีในคลัง = ขายไม่ได้ ห้ามหักเครดิตเด็ดขาด
resetDb(); u = freshUid(); withUser(u);
r = await call("/order", { idToken: "token:" + u, items: [{ id: "p1", qty: 1 }] });
ok("คลังไอดีว่าง = สั่งไม่ผ่าน", r.body.error === "OUT_OF_STOCK", JSON.stringify(r.body));
ok("เครดิตไม่ถูกหักตอนสั่งไม่ผ่าน", Number(DOCS.get("users/" + u).credit.integerValue) === 1000);
ok("ไม่มีออเดอร์ค้างไว้", ![...DOCS.keys()].some(k => k.startsWith("orders/")));

// ชิ้นในคลังที่ยังไม่ได้กรอกไอดี ห้ามส่งให้ลูกค้า
resetDb(); u = freshUid(); withUser(u);
DOCS.set("products/p1/stockItems/blank", F({ login: "", password: "", note: "", status: "available" }));
r = await call("/order", { idToken: "token:" + u, items: [{ id: "p1", qty: 1 }] });
ok("ชิ้นว่างเปล่าในคลัง = หยุดไว้ ไม่ส่งของว่าง", r.body.error === "ITEM_NOT_READY", JSON.stringify(r.body));
ok("เครดิตไม่ถูกหักตอนเจอชิ้นว่าง", Number(DOCS.get("users/" + u).credit.integerValue) === 1000);

section("สั่งซื้อ — เคสที่ต้องปฏิเสธ");
const bad = async (items, expect, name) => {
  resetDb(); const uu = freshUid(); withUser(uu);
  const rr = await call("/order", { idToken: "token:" + uu, items });
  ok(name, rr.body.error === expect, "ได้ " + rr.body.error);
};
await bad([], "EMPTY_CART", "ตะกร้าว่าง");
await bad([{ id: "ไม่มีจริง", qty: 1 }], "BAD_ITEM", "รหัสสินค้าผิดรูปแบบ");
await bad([{ id: "zzz", qty: 1 }], "PRODUCT_NOT_FOUND", "ไม่มีสินค้านี้");
await bad([{ id: "p3", qty: 1 }], "PRODUCT_INACTIVE", "สินค้าปิดขาย");
await bad([{ id: "p4", qty: 1 }], "BAD_PRICE", "สินค้าไม่มีราคา");
await bad([{ id: "p1", qty: 99 }], "OUT_OF_STOCK", "เกินสต๊อก");
await bad([{ id: "p1", qty: 0 }], "BAD_QTY", "จำนวน 0");
await bad([{ id: "p1", qty: -3 }], "BAD_QTY", "จำนวนติดลบ");
await bad([{ id: "p1", qty: "abc" }], "BAD_QTY", "จำนวนเป็นตัวอักษร");
await bad([{ id: "p1", qty: 1e9 }], "BAD_QTY", "จำนวนมหาศาล");
await bad(Array.from({ length: 60 }, () => ({ id: "p1", qty: 1 })), "TOO_MANY_ITEMS", "รายการเยอะเกิน");
await bad([{ id: "p1", qty: 4 }, { id: "p1", qty: 4 }], "OUT_OF_STOCK", "รวมจำนวนซ้ำก่อนเช็คสต๊อก");

section("ของเติมเกม — ข้อมูลไอดีลูกค้า");
const itemFields = key => {
  const k = [...DOCS.keys()].find(x => x.startsWith("orders/"));
  return DOCS.get(k).items.arrayValue.values[0].mapValue.fields[key];
};

resetDb(); u = freshUid(); withUser(u);
r = await call("/order", { idToken: "token:" + u, items: [{ id: "pUid", qty: 1, gameUid: "  12345678  " }] });
ok("สั่งของที่ขอ UID ได้เมื่อกรอกมา", r.body.ok === true, JSON.stringify(r.body));
ok("เก็บ UID ลงออเดอร์ (ตัดช่องว่างหัวท้าย)", itemFields("gameUid")?.stringValue === "12345678",
  itemFields("gameUid")?.stringValue);

resetDb(); u = freshUid(); withUser(u);
r = await call("/order", { idToken: "token:" + u,
  items: [{ id: "pLogin", qty: 1, gameLogin: "player01", gamePassword: "pw1234" }] });
ok("สั่งของที่ขอชื่อผู้ใช้+รหัสผ่านได้", r.body.ok === true, JSON.stringify(r.body));
ok("เก็บชื่อผู้ใช้ลงออเดอร์", itemFields("gameLogin")?.stringValue === "player01");
ok("เก็บรหัสผ่านลงออเดอร์", itemFields("gamePassword")?.stringValue === "pw1234");

// สินค้าที่ไม่ได้ติ๊กขออะไร ลูกค้าแนบมาก็ต้องไม่ถูกบันทึก
resetDb(); u = freshUid(); withUser(u);
r = await call("/order", { idToken: "token:" + u,
  items: [{ id: "p2", qty: 1, gameUid: "แอบยัด", gameLogin: "x", gamePassword: "y" }] });
ok("สินค้าที่ไม่ได้ขอ ข้อมูลแนบมาถูกทิ้ง", r.body.ok === true && !itemFields("gameUid") && !itemFields("gamePassword"));

// ยาวเกินต้องถูกตัด กันยัดข้อมูลก้อนใหญ่เข้าฐานข้อมูล
resetDb(); u = freshUid(); withUser(u);
r = await call("/order", { idToken: "token:" + u, items: [{ id: "pUid", qty: 1, gameUid: "9".repeat(500) }] });
ok("ตัดข้อมูลที่ยาวเกิน 120 ตัว", itemFields("gameUid")?.stringValue.length === 120,
  "ได้ " + itemFields("gameUid")?.stringValue.length);

await bad([{ id: "pUid", qty: 1 }], "NEED_CUSTOMER_INFO", "ขอ UID แต่ไม่กรอก = ปฏิเสธ");
await bad([{ id: "pUid", qty: 1, gameUid: "   " }], "NEED_CUSTOMER_INFO", "กรอก UID เป็นช่องว่าง = ปฏิเสธ");
await bad([{ id: "pLogin", qty: 1, gameLogin: "player01" }], "NEED_CUSTOMER_INFO", "กรอกชื่อผู้ใช้แต่ไม่กรอกรหัสผ่าน = ปฏิเสธ");
await bad([{ id: "pLogin", qty: 1, gamePassword: "pw" }], "NEED_CUSTOMER_INFO", "กรอกรหัสผ่านแต่ไม่กรอกชื่อผู้ใช้ = ปฏิเสธ");

resetDb(); u = freshUid(); withUser(u, 100);
r = await call("/order", { idToken: "token:" + u, items: [{ id: "p1", qty: 1 }] });
ok("เครดิตไม่พอ = ปฏิเสธ", r.body.error === "NOT_ENOUGH_CREDIT");
ok("ไม่มีออเดอร์ค้างไว้", ![...DOCS.keys()].some(k => k.startsWith("orders/")));

resetDb(); u = freshUid();
r = await call("/order", { idToken: "token:" + u, items: [{ id: "p1", qty: 1 }] });
ok("ไม่มีโปรไฟล์ = ปฏิเสธ", r.body.error === "NO_PROFILE");

section("สินค้าสต๊อกไม่จำกัด + เศษสตางค์");
resetDb(); u = freshUid(); withUser(u);
r = await call("/order", { idToken: "token:" + u, items: [{ id: "p2", qty: 30 }] });
ok("สินค้าที่ไม่ได้ตั้งสต๊อก สั่งได้ไม่จำกัด", r.body.ok === true && r.body.total === 600, JSON.stringify(r.body));

resetDb(); u = freshUid(); withUser(u);
DOCS.set("products/pd", F({ name: "ราคาเศษ", price: 19.9, active: true }));
r = await call("/order", { idToken: "token:" + u, items: [{ id: "pd", qty: 3 }] });
ok("ยอดรวมเศษสตางค์ไม่เพี้ยน (19.9 x 3 = 59.7)", r.body.total === 59.7, "ได้ " + r.body.total);

section("จำกัดจำนวนครั้ง");
resetDb(); u = freshUid(); withUser(u);
let limited = 0;
for (let i = 0; i < 12; i++) {
  const rr = await call("/order", { idToken: "token:" + u, items: [{ id: "p2", qty: 1 }] });
  if (rr.body.error === "RATE_LIMITED") limited++;
}
ok("ยิงรัวๆ แล้วโดนจำกัด", limited > 0, "โดนจำกัด " + limited + " ครั้ง");
resetDb(); const u2 = freshUid(); withUser(u2);
r = await call("/order", { idToken: "token:" + u2, items: [{ id: "p2", qty: 1 }] });
ok("คนอื่นไม่โดนหางเลข", r.body.ok === true);


// =====================================================================
// ===== เส้นทางแอดมิน (/admin/*) — โค้ดจริงของ Worker =====
const numOf = f => Number(f?.integerValue ?? f?.doubleValue ?? 0);
const strOf = f => String(f?.stringValue ?? "");
const logsOf = () => [...DOCS.entries()].filter(([k]) => k.startsWith("adminLogs/")).map(([, v]) => v);
const mkAdmin = (uid, email) => {
  DOCS.set("users/" + uid, F({ name: "แอดมิน", email: email || "admin@x.com", credit: 0, role: "admin" }));
  setClaim(uid, { admin: true });
  return uid;
};

section("แอดมิน — ต้องมีสิทธิ์ครบ 2 ชั้น");
resetDb();
const A = mkAdmin(freshUid());
const C1 = freshUid();
DOCS.set("users/" + C1, F({ name: "ลูกค้า", email: "c@x.com", credit: 100, role: "member" }));

let ar = await call("/admin/credit", { idToken: "token:" + C1, uid: C1, amount: 1000 });
ok("ลูกค้าธรรมดายิงเส้นทางแอดมินไม่ผ่าน", ar.body.error === "ADMIN_ONLY", JSON.stringify(ar.body));
ok("ตอบรหัส 403", ar.status === 403);
ok("เครดิตลูกค้าไม่ขยับ", numOf(DOCS.get("users/" + C1).credit) === 100);

const claimOnly = freshUid();
DOCS.set("users/" + claimOnly, F({ name: "ปลอม", email: "f@x.com", credit: 0, role: "member" }));
setClaim(claimOnly, { admin: true });
ar = await call("/admin/credit", { idToken: "token:" + claimOnly, uid: C1, amount: 500 });
ok("มี claim แต่เอกสารไม่ใช่ admin = ไม่ผ่าน", ar.body.error === "ADMIN_ONLY");

const roleOnly = freshUid();
DOCS.set("users/" + roleOnly, F({ name: "ปลอม2", email: "f2@x.com", credit: 0, role: "admin" }));
setClaim(roleOnly, {});
ar = await call("/admin/credit", { idToken: "token:" + roleOnly, uid: C1, amount: 500 });
ok("เอกสารเป็น admin แต่ไม่มี claim = ไม่ผ่าน", ar.body.error === "ADMIN_ONLY");

ar = await call("/admin/credit", { idToken: "token:" + A, uid: C1, amount: 50 }, "https://evil.com");
ok("ยิงจากโดเมนแปลกปลอมไม่ผ่าน", ar.body.error === "BAD_ORIGIN");

section("แอดมิน — ปรับเครดิต");
ar = await call("/admin/credit", { idToken: "token:" + A, uid: C1, amount: 250.5, note: "โอนมาเพิ่ม" });
ok("ปรับเครดิตสำเร็จ", ar.body.ok === true, JSON.stringify(ar.body));
ok("เครดิตเพิ่มตามจริง", numOf(DOCS.get("users/" + C1).credit) === 350.5,
  String(numOf(DOCS.get("users/" + C1).credit)));
ok("บันทึกลงประวัติเติมเงิน (method=admin)",
  [...DOCS.values()].some(v => strOf(v.method) === "admin" && numOf(v.amount) === 250.5));
ok("มีบันทึกใน adminLogs", logsOf().some(l => strOf(l.action) === "credit.adjust"));
ok("บันทึกเก็บยอดก่อน-หลัง", logsOf().some(l => numOf(l.before) === 100 && numOf(l.after) === 350.5));

ok("ยอด 0 ไม่ได้", (await call("/admin/credit", { idToken: "token:" + A, uid: C1, amount: 0 })).body.error === "AMOUNT_INVALID");
ok("ยอดเกินเพดานไม่ได้", (await call("/admin/credit", { idToken: "token:" + A, uid: C1, amount: 100001 })).body.error === "AMOUNT_TOO_LARGE");
ok("หักจนติดลบไม่ได้", (await call("/admin/credit", { idToken: "token:" + A, uid: C1, amount: -1000 })).body.error === "WOULD_GO_NEGATIVE");
ok("uid ผิดรูปแบบไม่ได้", (await call("/admin/credit", { idToken: "token:" + A, uid: "../ห้าม", amount: 5 })).body.error === "BAD_REQUEST");
ok("สมาชิกไม่มีอยู่จริงไม่ได้", (await call("/admin/credit", { idToken: "token:" + A, uid: "ghost", amount: 5 })).body.error === "MEMBER_NOT_FOUND");
ok("เครดิตยังเท่าเดิมหลังคำสั่งที่ล้มเหลว", numOf(DOCS.get("users/" + C1).credit) === 350.5);

section("แอดมิน — อนุมัติเติมเงิน");
DOCS.set("topups/tp1", F({ uid: C1, amount: 100, method: "bank", hasSlip: true, status: "pending" }));
ar = await call("/admin/topup/approve", { idToken: "token:" + A, topupId: "tp1" });
ok("อนุมัติเติมเงินสำเร็จ", ar.body.ok === true, JSON.stringify(ar.body));
ok("เครดิตเข้าเรียบร้อย", numOf(DOCS.get("users/" + C1).credit) === 450.5);
ok("สถานะเปลี่ยนเป็น approved", strOf(DOCS.get("topups/tp1").status) === "approved");
ok("อนุมัติซ้ำไม่ได้", (await call("/admin/topup/approve", { idToken: "token:" + A, topupId: "tp1" })).body.error === "ALREADY_HANDLED");
ok("ไม่อนุมัติทับของที่อนุมัติแล้วไม่ได้", (await call("/admin/topup/reject", { idToken: "token:" + A, topupId: "tp1" })).body.error === "ALREADY_HANDLED");
ok("เครดิตไม่เข้าซ้ำ", numOf(DOCS.get("users/" + C1).credit) === 450.5);

DOCS.set("topups/tp0", F({ uid: C1, amount: 0, method: "angpao", angpaoLink: "x", status: "pending" }));
ok("รายการยอด 0 ต้องใส่ยอดก่อน", (await call("/admin/topup/approve", { idToken: "token:" + A, topupId: "tp0" })).body.error === "AMOUNT_MISSING");
ar = await call("/admin/topup/approve", { idToken: "token:" + A, topupId: "tp0", amount: 25.5 });
ok("ใส่ยอดแทนแล้วอนุมัติได้", ar.body.ok === true && numOf(DOCS.get("users/" + C1).credit) === 476);

DOCS.set("topups/tp2", F({ uid: C1, amount: 50, method: "bank", hasSlip: true, status: "pending" }));
ar = await call("/admin/topup/reject", { idToken: "token:" + A, topupId: "tp2", note: "สลิปปลอม" });
ok("ไม่อนุมัติได้", ar.body.ok === true && strOf(DOCS.get("topups/tp2").status) === "rejected");
ok("เครดิตไม่เข้าตอนไม่อนุมัติ", numOf(DOCS.get("users/" + C1).credit) === 476);

section("แอดมิน — อนุมัติออเดอร์ (หักเครดิต + ส่งมอบไอดี)");
DOCS.set("products/p1/stockItems/s1", F({ login: "user1", password: "pw1", note: "", status: "available" }));
DOCS.set("products/p1/stockItems/s2", F({ login: "user2", password: "pw2", note: "", status: "available" }));
DOCS.set("products/p1/stockItems/s3", F({ login: "user3", password: "pw3", note: "", status: "available" }));
const mkOrder = (id, uid, qty, total) => DOCS.set("orders/" + id, {
  ...F({ uid, total, status: "pending" }),
  items: { arrayValue: { values: [{ mapValue: { fields: F({ id: "p1", name: "ไอดีเกม A", price: 300, qty }) } }] } },
});
mkOrder("o1", C1, 1, 300);
ar = await call("/admin/order/approve", { idToken: "token:" + A, orderId: "o1" });
ok("อนุมัติออเดอร์สำเร็จ", ar.body.ok === true, JSON.stringify(ar.body));
ok("หักเครดิตลูกค้าถูกต้อง", numOf(DOCS.get("users/" + C1).credit) === 176,
  String(numOf(DOCS.get("users/" + C1).credit)));
ok("สถานะเป็น approved", strOf(DOCS.get("orders/o1").status) === "approved");
ok("ตัดสต๊อกสินค้า", numOf(DOCS.get("products/p1").stock) === 4);
const deliv = DOCS.get("orders/o1").items.arrayValue.values[0].mapValue.fields.delivered;
ok("ส่งมอบไอดีเข้าออเดอร์", !!deliv && deliv.arrayValue.values.length === 1);
ok("ไอดีที่ส่งมีรหัสผ่านจริง",
  strOf(deliv.arrayValue.values[0].mapValue.fields.password).length > 0);
ok("ชิ้นในคลังถูกทำเครื่องหมายว่าขายแล้ว",
  strOf(DOCS.get("products/p1/stockItems/s1").status) === "sold");
ok("ชิ้นที่ขายแล้วผูกกับออเดอร์", strOf(DOCS.get("products/p1/stockItems/s1").orderId) === "o1");
ok("อนุมัติออเดอร์ซ้ำไม่ได้", (await call("/admin/order/approve", { idToken: "token:" + A, orderId: "o1" })).body.error === "ALREADY_HANDLED");
ok("ไม่อนุมัติทับออเดอร์ที่อนุมัติแล้วไม่ได้", (await call("/admin/order/reject", { idToken: "token:" + A, orderId: "o1" })).body.error === "ALREADY_HANDLED");

mkOrder("o2", C1, 1, 300);
DOCS.set("users/" + C1, { ...DOCS.get("users/" + C1), credit: V(10) });
ar = await call("/admin/order/approve", { idToken: "token:" + A, orderId: "o2" });
ok("เครดิตลูกค้าไม่พอ = อนุมัติไม่ได้", ar.body.error === "INSUFFICIENT_CUSTOMER_CREDIT");
ok("ไม่มีอะไรถูกเขียนตอนล้มเหลว", strOf(DOCS.get("orders/o2").status) === "pending"
  && numOf(DOCS.get("products/p1").stock) === 4);

DOCS.set("users/" + C1, { ...DOCS.get("users/" + C1), credit: V(5000) });
mkOrder("o3", C1, 5, 1500);
ar = await call("/admin/order/approve", { idToken: "token:" + A, orderId: "o3" });
ok("ไอดีในคลังไม่พอ = อนุมัติไม่ได้", ar.body.error === "NOT_ENOUGH_STOCK_ITEMS");
ok("เครดิตไม่ถูกหักตอนของไม่พอ", numOf(DOCS.get("users/" + C1).credit) === 5000);

DOCS.set("products/p1/stockItems/s9", F({ login: "", password: "", note: "", status: "available" }));
DOCS.set("products/p1", F({ name: "ไอดีเกม A", price: 300, stock: 9, active: true, digital: true }));
mkOrder("o4", C1, 3, 900);
ar = await call("/admin/order/approve", { idToken: "token:" + A, orderId: "o4" });
ok("มีชิ้นว่างเปล่าในคลัง = หยุดไว้ ไม่ส่งของว่าง", ar.body.error === "EMPTY_STOCK_ITEM");
ok("เครดิตไม่ถูกหักตอนเจอชิ้นว่าง", numOf(DOCS.get("users/" + C1).credit) === 5000);

mkOrder("o5", C1, 1, 300);
ar = await call("/admin/order/reject", { idToken: "token:" + A, orderId: "o5", note: "ลูกค้าขอยกเลิก" });
ok("ไม่อนุมัติออเดอร์ได้", ar.body.ok === true && strOf(DOCS.get("orders/o5").status) === "rejected");
ok("เครดิตไม่ถูกหักตอนไม่อนุมัติ", numOf(DOCS.get("users/" + C1).credit) === 5000);

section("แอดมิน — ลบข้อมูลลูกค้าออกจากออเดอร์");
DOCS.set("orders/o6", {
  ...F({ uid: C1, total: 80, status: "approved" }),
  items: { arrayValue: { values: [{ mapValue: { fields: F({ id: "pLogin", name: "เติมเกม", price: 80, qty: 1, gameUid: "999", gameLogin: "myuser", gamePassword: "mypass" }) } }] } },
});
ar = await call("/admin/order/clear-info", { idToken: "token:" + A, orderId: "o6" });
const it6 = DOCS.get("orders/o6").items.arrayValue.values[0].mapValue.fields;
ok("ลบรหัสผ่านลูกค้าออกได้", ar.body.ok === true && !it6.gamePassword);
ok("ลบชื่อผู้ใช้ลูกค้าออกด้วย", !it6.gameLogin);
ok("ไอดีเกม/UID ยังอยู่เป็นหลักฐาน", strOf(it6.gameUid) === "999");
ok("บันทึกเวลาที่ลบไว้", !!DOCS.get("orders/o6").customerInfoClearedAt);

section("แอดมิน — ตั้ง/ถอดสิทธิ์ (custom claim)");
ok("ถอดสิทธิ์ตัวเองไม่ได้", (await call("/admin/role", { idToken: "token:" + A, uid: A, makeAdmin: false })).body.error === "CANNOT_CHANGE_SELF");
ok("ค่า makeAdmin ต้องเป็น true/false เท่านั้น", (await call("/admin/role", { idToken: "token:" + A, uid: C1, makeAdmin: "yes" })).body.error === "BAD_REQUEST");
ok("ตั้งสิทธิ์ให้คนที่ไม่มีบัญชีไม่ได้", (await call("/admin/role", { idToken: "token:" + A, uid: "ghost", makeAdmin: true })).body.error === "MEMBER_NOT_FOUND");

ar = await call("/admin/role", { idToken: "token:" + A, uid: C1, makeAdmin: true });
ok("ตั้งคนอื่นเป็นแอดมินได้", ar.body.ok === true, JSON.stringify(ar.body));
ok("claim ถูกตั้งในบัญชีจริง", claimOf(C1).admin === true);
ok("เอกสารถูกตั้งเป็น admin ด้วย", strOf(DOCS.get("users/" + C1).role) === "admin");

ar = await call("/admin/role", { idToken: "token:" + A, uid: C1, makeAdmin: false });
ok("ถอนสิทธิ์ได้", ar.body.ok === true);
ok("claim ถูกล้าง", claimOf(C1).admin !== true);
ok("เอกสารกลับเป็น member", strOf(DOCS.get("users/" + C1).role) === "member");
ok("มีบันทึกทั้งตอนตั้งและตอนถอน",
  logsOf().some(l => strOf(l.action) === "role.grant") &&
  logsOf().some(l => strOf(l.action) === "role.revoke"));

section("แอดมิน — เมื่อ service account ยังไม่มีสิทธิ์ตั้ง claim");
denyClaims(true);
ar = await call("/admin/role", { idToken: "token:" + A, uid: C1, makeAdmin: true });
ok("บอกสาเหตุชัดเจนว่าไม่มีสิทธิ์", ar.body.error === "CLAIMS_PERMISSION", JSON.stringify(ar.body));
ok("ล้มเหลวแล้วต้องไม่ตั้ง role ให้ก่อน (fail closed)",
  strOf(DOCS.get("users/" + C1).role) === "member");

// ถอนสิทธิ์: ต้องลด role ก่อนเสมอ ถึงแม้ล้าง claim ไม่สำเร็จก็หมดสิทธิ์แล้ว
setClaim(C1, { admin: true });
DOCS.set("users/" + C1, { ...DOCS.get("users/" + C1), role: V("admin") });
ar = await call("/admin/role", { idToken: "token:" + A, uid: C1, makeAdmin: false });
ok("ถอนสิทธิ์ตอนตั้ง claim ไม่ได้ ก็ยังลด role สำเร็จ",
  strOf(DOCS.get("users/" + C1).role) === "member");
denyClaims(false);
setClaim(C1, {});

section("ตั้งแอดมินคนแรกด้วยรหัสลับ (/admin/bootstrap)");
const B = freshUid();
DOCS.set("users/" + B, F({ name: "เจ้าของ", email: "owner@x.com", credit: 0, role: "member" }));
ok("รหัสผิด = ไม่ได้สิทธิ์", (await call("/admin/bootstrap", { idToken: "token:" + B, secret: "มั่วๆ" })).body.error === "BOOTSTRAP_BAD_SECRET");
ok("ไม่ส่งรหัสมาเลยก็ไม่ได้", (await call("/admin/bootstrap", { idToken: "token:" + B })).body.error === "BOOTSTRAP_BAD_SECRET");
ok("ยังไม่ได้เป็นแอดมิน", claimOf(B).admin !== true);

const envNoSecret = { ...env, ADMIN_BOOTSTRAP: "" };
const resNo = await W.fetch(new Request("https://b.dev/admin/bootstrap", {
  method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
  body: JSON.stringify({ idToken: "token:" + B, secret: "อะไรก็ได้" }),
}), envNoSecret);
ok("ถ้ายังไม่ตั้งรหัสลับ = ปิดเส้นทางนี้ทิ้ง", (await resNo.json()).error === "BOOTSTRAP_DISABLED");

ar = await call("/admin/bootstrap", { idToken: "token:" + B, secret: env.ADMIN_BOOTSTRAP });
ok("รหัสถูก = ตั้งแอดมินคนแรกได้", ar.body.ok === true, JSON.stringify(ar.body));
ok("ได้ claim", claimOf(B).admin === true);
ok("เอกสารเป็น admin", strOf(DOCS.get("users/" + B).role) === "admin");
ok("มีบันทึกไว้ว่าใครใช้รหัสลับ", logsOf().some(l => strOf(l.action) === "role.bootstrap"));

section("bootstrap กับบัญชีที่ยังไม่มีเอกสารสมาชิก");
{
  const NB = freshUid();                 // ล็อกอินแล้วแต่ยังไม่มีเอกสารใน users
  const rr = await call("/admin/bootstrap", { idToken: "token:" + NB, secret: env.ADMIN_BOOTSTRAP });
  // เคยเป็นบั๊ก: NO_PROFILE ไม่อยู่ในรายการรหัสที่ส่งกลับได้ เลยกลายเป็น ADMIN_FAILED (500)
  ok("บอกสาเหตุตรงๆ ว่ายังไม่มีเอกสารสมาชิก", rr.body.error === "NO_PROFILE", JSON.stringify(rr.body));
  ok("ตอบเป็นข้อผิดพลาดฝั่งผู้เรียก ไม่ใช่ 500", rr.status === 400, String(rr.status));
  ok("ไม่ได้สิทธิ์ติดตัวไป", claimOf(NB).admin !== true);
}

section("ตรวจสถานะสิทธิ์ของตัวเอง (/admin/whoami)");
ar = await call("/admin/whoami", { idToken: "token:" + B });
ok("แอดมินเห็นว่าตัวเองครบทั้งสองชั้น", ar.body.admin === true && ar.body.claim === true && ar.body.role === "admin");
const W1 = freshUid();
DOCS.set("users/" + W1, F({ name: "ลูกค้า", email: "w@x.com", credit: 0, role: "member" }));
ar = await call("/admin/whoami", { idToken: "token:" + W1 });
ok("สมาชิกธรรมดาเห็นว่าตัวเองไม่ใช่แอดมิน", ar.body.admin === false);

section("บัญชีที่ถูกปิดใช้งาน");
const D1 = mkAdmin(freshUid());
DISABLED.add(D1);
ar = await call("/admin/credit", { idToken: "token:" + D1, uid: C1, amount: 100 });
ok("บัญชีถูกปิด = ใช้โทเคนเดิมทำอะไรไม่ได้", ar.body.error === "UNAUTHORIZED" && ar.status === 401);
DISABLED.delete(D1);

section("ตรวจสภาพเซิร์ฟเวอร์ (/admin/diagnose)");
const DG = mkAdmin(freshUid());
ok("รหัสลับผิด = ไม่ให้ดู", (await call("/admin/diagnose",
  { idToken: "token:" + DG, secret: "รหัสมั่วxxxxxxxxxxxxxxxxxx" })).body.error === "BOOTSTRAP_BAD_SECRET");
ar = await call("/admin/diagnose", { idToken: "token:" + DG, secret: env.ADMIN_BOOTSTRAP });
ok("บอกว่าใช้ service account ตัวไหน", ar.body.serviceAccount === "x@y", JSON.stringify(ar.body));
ok("บอกว่าตั้ง claim ได้หรือยัง", ar.body.claimsOk === true, JSON.stringify(ar.body));
// เคยเป็นบั๊ก: ตรวจสภาพด้วยการ "เขียน claim เดิมทับ" ทำให้สิทธิ์ของคนกดตรวจหายได้
ok("ตรวจสภาพต้องไม่ไปแตะ claim ของคนที่กดตรวจ", claimOf(DG).admin === true);

denyClaims(true);
ar = await call("/admin/diagnose", { idToken: "token:" + DG, secret: env.ADMIN_BOOTSTRAP });
ok("ถ้า service account ไม่มีสิทธิ์ ต้องบอกว่ายังตั้ง claim ไม่ได้", ar.body.claimsOk === false, JSON.stringify(ar.body));
ok("พร้อมบอกสาเหตุให้ไปแก้ต่อได้", String(ar.body.detail || "").includes("PERMISSION_DENIED"), ar.body.detail);
denyClaims(false);

section("ตั้งสิทธิ์แล้วเขียนเอกสารไม่สำเร็จ — ต้องไม่ทิ้ง claim ค้างไว้");
{
  const T2 = freshUid();
  DOCS.set("users/" + T2, F({ name: "เป้าหมาย", email: "t2@x.com", credit: 0, role: "member" }));
  failCommitFor("users/" + T2);          // ให้คำสั่งเขียนเอกสารของคนนี้พังหนึ่งครั้ง
  ar = await call("/admin/role", { idToken: "token:" + A, uid: T2, makeAdmin: true });
  ok("ตั้งสิทธิ์ไม่สำเร็จ = ตอบว่าล้มเหลว", ar.body.ok !== true, JSON.stringify(ar.body));
  ok("เอกสารยังเป็น member เหมือนเดิม", strOf(DOCS.get("users/" + T2).role) === "member");
  ok("claim ที่ใส่ไปก่อนหน้าถูกเก็บกวาดออก ไม่ค้างเป็นขยะ", claimOf(T2).admin !== true,
    JSON.stringify(claimOf(T2)));
  FAIL_COMMIT_PATH = null;
}

section("เอกสารที่ข้อมูลเสีย ต้องไม่ลามไปทำเครดิต/สต๊อกพัง");
{
  // ค่าที่คำนวณไม่ได้ (NaN) เปรียบเทียบกับอะไรก็ได้ false หมด
  // ถ้าไม่ดักไว้ ด่าน "เครดิตพอไหม/สต๊อกพอไหม" จะผ่านตลอด แล้วเขียนค่าเสียทับกลับลงฐานข้อมูล
  // ห้ามล้างฐานข้อมูลตรงนี้ เทสหมวดถัดไปยังใช้ข้อมูลชุดเดิมอยู่
  const A2 = mkAdmin(freshUid());
  const C2 = freshUid();
  DOCS.set("users/" + C2, F({ name: "ลูกค้า", email: "c@x.com", credit: 500, role: "member" }));
  DOCS.set("products/pNaN", F({ name: "ของทดสอบ", price: 100, stock: 5, active: true, digital: true }));
  DOCS.set("products/pNaN/stockItems/sN1", F({ login: "u1", password: "p1", status: "available" }));

  const mkBadOrder = (id, fields, items) => DOCS.set("orders/" + id, {
    ...F({ uid: C2, status: "pending", ...fields }),
    items: { arrayValue: { values: [{ mapValue: { fields: F(items) } }] } },
  });

  // ยอดรวมเป็นค่าที่คำนวณไม่ได้
  DOCS.set("orders/oNaN", {
    ...F({ uid: C2, status: "pending" }),
    total: { doubleValue: NaN },
    items: { arrayValue: { values: [{ mapValue: { fields: F({ id: "pNaN", name: "x", price: 1, qty: 1 }) } }] } },
  });
  let rr = await call("/admin/order/approve", { idToken: "token:" + A2, orderId: "oNaN" });
  ok("ยอดรวมเสีย = ปฏิเสธ ไม่หักเครดิต", rr.body.ok !== true, JSON.stringify(rr.body));
  ok("เครดิตลูกค้ายังเท่าเดิม", numOf(DOCS.get("users/" + C2).credit) === 500);

  // จำนวนสินค้าเป็นค่าที่คำนวณไม่ได้
  mkBadOrder("oQty", { total: 300 }, { id: "pNaN", name: "x", price: 300, qty: "มั่ว" });
  rr = await call("/admin/order/approve", { idToken: "token:" + A2, orderId: "oQty" });
  ok("จำนวนสินค้าเสีย = ปฏิเสธ", rr.body.error === "BAD_REQUEST", JSON.stringify(rr.body));
  ok("สต๊อกไม่ถูกเขียนเป็นค่าเสีย", Number.isFinite(numOf(DOCS.get("products/pNaN").stock)),
    JSON.stringify(DOCS.get("products/pNaN").stock));

  // เครดิตในเอกสารสมาชิกเสียเอง
  DOCS.set("users/" + C2, { ...DOCS.get("users/" + C2), credit: { doubleValue: NaN } });
  mkBadOrder("oCredit", { total: 100 }, { id: "pNaN", name: "x", price: 100, qty: 1 });
  rr = await call("/admin/order/approve", { idToken: "token:" + A2, orderId: "oCredit" });
  ok("เครดิตในเอกสารเสีย = ปฏิเสธ ไม่เขียนทับ", rr.body.ok !== true, JSON.stringify(rr.body));

  // เครดิตที่เสียถูกอ่านเป็น 0 แล้วซ่อมกลับเป็นตัวเลขปกติ — ไม่ปล่อยให้ค้างเป็นค่าที่ใช้ไม่ได้
  rr = await call("/admin/credit", { idToken: "token:" + A2, uid: C2, amount: 50 });
  ok("ปรับเครดิตแล้วซ่อมค่าที่เสียให้กลับมาใช้ได้", rr.body.ok === true && rr.body.after === 50,
    JSON.stringify(rr.body));
  ok("เครดิตในฐานข้อมูลเป็นตัวเลขที่ใช้งานได้แล้ว",
    Number.isFinite(numOf(DOCS.get("users/" + C2).credit)), JSON.stringify(DOCS.get("users/" + C2).credit));

  DOCS.set("topups/tpBad", F({ uid: C2, amount: 50, method: "bank", hasSlip: true, status: "pending" }));
  rr = await call("/admin/topup/approve", { idToken: "token:" + A2, topupId: "tpBad" });
  ok("อนุมัติเติมเงินต่อจากนั้นได้ตามปกติ", rr.body.ok === true && rr.body.after === 100,
    JSON.stringify(rr.body));
}

section("ลิงก์ซองที่รหัสยาวผิดปกติ");
{
  const LU = freshUid(); withUser(LU);
  const long = "https://gift.truemoney.com/campaign/?v=" + "A".repeat(200);
  const rr = await call("/", { idToken: "token:" + LU, link: long });
  // ถ้าปล่อยผ่าน รหัสยาวจะไปเป็นชื่อเอกสารที่ Firestore ไม่รับ แล้วตอบว่า "ใช้ไปแล้ว" ซึ่งผิด
  ok("บอกว่าลิงก์ไม่ถูกต้อง ไม่ใช่ 'ซองถูกใช้แล้ว'", rr.body.error === "INVALID_LINK", JSON.stringify(rr.body));
  const okLen = await call("/", { idToken: "token:" + freshUid(), link: "https://gift.truemoney.com/campaign/?v=" + "B".repeat(32) });
  ok("รหัสความยาวปกติยังใช้ได้ตามเดิม", okLen.body.error !== "INVALID_LINK", JSON.stringify(okLen.body));
}

section("เส้นทางแอดมินที่ไม่มีอยู่จริง");
ok("เส้นทางมั่วถูกปฏิเสธ", (await call("/admin/ห้าม", { idToken: "token:" + A })).body.error === "NOT_FOUND");

// =====================================================================
// ===== ออเดอร์ระบบใหม่: 3 สถานะ + ยกเลิกคืนเครดิต + ลูกค้าแก้ข้อมูลเอง =====
section("ออเดอร์ระบบใหม่ — 3 สถานะ");
{
  resetDb();
  const AD = mkAdmin(freshUid(), "boss@x.com");
  const CU = freshUid(); withUser(CU, 500);
  // สั่งของเติมเกมผ่านเส้นทางจริง จะได้ออเดอร์ที่มี paid=true เหมือนของจริง
  let rr = await call("/order", { idToken: "token:" + CU,
    items: [{ id: "pLogin", qty: 1, gameLogin: "player01", gamePassword: "pw1234" }] });
  ok("สั่งของเติมเกมสำเร็จ", rr.body.ok === true, JSON.stringify(rr.body));
  const OID = rr.body.orderId;
  ok("หักเครดิตแล้ว", numOf(DOCS.get("users/" + CU).credit) === 420,
    String(numOf(DOCS.get("users/" + CU).credit)));

  // กดข้ามขั้นไม่ได้ ต้องกดเริ่มดำเนินการก่อนเสมอ
  ok("กด ทำเสร็จแล้ว ข้ามขั้นไม่ได้",
    (await call("/admin/order/complete", { idToken: "token:" + AD, orderId: OID })).body.error === "ALREADY_HANDLED");

  rr = await call("/admin/order/start", { idToken: "token:" + AD, orderId: OID });
  ok("เริ่มดำเนินการได้", rr.body.ok === true && strOf(DOCS.get("orders/" + OID).status) === "processing",
    JSON.stringify(rr.body));
  ok("บันทึกลง adminLogs", logsOf().some(l => strOf(l.action) === "order.start"));
  ok("กดเริ่มซ้ำไม่ได้",
    (await call("/admin/order/start", { idToken: "token:" + AD, orderId: OID })).body.error === "ALREADY_HANDLED");

  rr = await call("/admin/order/complete", { idToken: "token:" + AD, orderId: OID });
  const done = DOCS.get("orders/" + OID);
  const di = done.items.arrayValue.values[0].mapValue.fields;
  ok("ทำเสร็จแล้วได้", rr.body.ok === true && strOf(done.status) === "completed", JSON.stringify(rr.body));
  ok("เริ่มจับเวลาเคลมตอนกดว่าเสร็จ", !!done.claimTimerStartedAt);
  ok("ลบรหัสผ่านลูกค้าอัตโนมัติ", !di.gamePassword, JSON.stringify(di.gamePassword));
  ok("ลบชื่อผู้ใช้ลูกค้าอัตโนมัติด้วย", !di.gameLogin);
  ok("บันทึกเวลาที่ลบข้อมูลไว้", !!done.customerInfoClearedAt);
  ok("กดเสร็จซ้ำไม่ได้",
    (await call("/admin/order/complete", { idToken: "token:" + AD, orderId: OID })).body.error === "ALREADY_HANDLED");
  ok("ใช้ปุ่มระบบเก่ากับออเดอร์ใหม่ไม่ได้",
    (await call("/admin/order/approve", { idToken: "token:" + AD, orderId: OID })).body.error === "NEW_FLOW_ORDER");
}

section("ออเดอร์ระบบใหม่ — ยกเลิก + คืนเครดิต");
{
  resetDb();
  const AD = mkAdmin(freshUid(), "boss2@x.com");
  const CU = freshUid(); withUser(CU, 500);
  let rr = await call("/order", { idToken: "token:" + CU, items: [{ id: "pUid", qty: 2, gameUid: "777" }] });
  const OID = rr.body.orderId;
  ok("สั่งซื้อและหักเครดิตแล้ว", numOf(DOCS.get("users/" + CU).credit) === 400,
    String(numOf(DOCS.get("users/" + CU).credit)));

  rr = await call("/admin/order/cancel", { idToken: "token:" + AD, orderId: OID, note: "ของหมดจริง" });
  ok("ยกเลิกได้", rr.body.ok === true, JSON.stringify(rr.body));
  ok("คืนเครดิตเต็มจำนวน", numOf(DOCS.get("users/" + CU).credit) === 500,
    String(numOf(DOCS.get("users/" + CU).credit)));
  ok("สถานะเป็น cancelled", strOf(DOCS.get("orders/" + OID).status) === "cancelled");
  ok("บันทึกยอดที่คืนไว้", numOf(DOCS.get("orders/" + OID).refundAmount) === 100);
  ok("บันทึกลง adminLogs", logsOf().some(l => strOf(l.action) === "order.cancel"));
  ok("กดยกเลิกซ้ำแล้วไม่คืนเครดิตซ้ำ",
    (await call("/admin/order/cancel", { idToken: "token:" + AD, orderId: OID })).body.error === "ALREADY_HANDLED");
  ok("เครดิตยังเท่าเดิมหลังกดซ้ำ", numOf(DOCS.get("users/" + CU).credit) === 500);
}

section("ยกเลิกออเดอร์ไอดีเกมที่ส่งของไปแล้ว — คืนเงินแต่ไม่คืนไอดีเข้าคลัง");
{
  resetDb(); withStock("p1", 2);
  const AD = mkAdmin(freshUid(), "boss3@x.com");
  const CU = freshUid(); withUser(CU, 1000);
  const rr = await call("/order", { idToken: "token:" + CU, items: [{ id: "p1", qty: 1 }] });
  const OID = rr.body.orderId;
  ok("ตัดสต๊อกไปแล้ว", numOf(DOCS.get("products/p1").stock) === 4);

  await call("/admin/order/cancel", { idToken: "token:" + AD, orderId: OID });
  ok("คืนเครดิตให้ลูกค้า", numOf(DOCS.get("users/" + CU).credit) === 1000);
  // ไอดีที่ลูกค้าเห็นรหัสไปแล้ว เอากลับมาขายใหม่ไม่ได้
  ok("ไม่คืนสต๊อกของที่ส่งไปแล้ว", numOf(DOCS.get("products/p1").stock) === 4,
    String(numOf(DOCS.get("products/p1").stock)));
  ok("ชิ้นในคลังยังเป็น sold", strOf(DOCS.get("products/p1/stockItems/k1").status) === "sold");
}

section("ลูกค้าแก้ข้อมูลไอดีเกมของตัวเอง");
{
  resetDb();
  const AD = mkAdmin(freshUid(), "boss4@x.com");
  const CU = freshUid(); withUser(CU, 500);
  const OTHER = freshUid(); withUser(OTHER, 500);
  let rr = await call("/order", { idToken: "token:" + CU,
    items: [{ id: "pLogin", qty: 1, gameLogin: "old_user", gamePassword: "old_pw" }] });
  const OID = rr.body.orderId;
  const itemsOf = () => DOCS.get("orders/" + OID).items.arrayValue.values[0].mapValue.fields;

  rr = await call("/order/edit-info", { idToken: "token:" + CU, orderId: OID,
    items: [{ index: 0, gameLogin: "  new_user  ", gamePassword: "new_pw" }] });
  ok("แก้ข้อมูลตอน รอดำเนินการ ได้", rr.body.ok === true, JSON.stringify(rr.body));
  ok("ค่าใหม่ถูกบันทึก (ตัดช่องว่างหัวท้าย)", strOf(itemsOf().gameLogin) === "new_user",
    strOf(itemsOf().gameLogin));
  ok("รหัสผ่านใหม่ถูกบันทึก", strOf(itemsOf().gamePassword) === "new_pw");

  const edits = DOCS.get("orders/" + OID).infoEdits.arrayValue.values.map(v => v.mapValue.fields);
  ok("เก็บประวัติการแก้ไว้ 2 รายการ", edits.length === 2, String(edits.length));
  ok("ประวัติเก็บค่าเดิมของชื่อผู้ใช้", edits.some(e => strOf(e.from) === "old_user"));
  ok("ประวัติไม่เก็บรหัสผ่านเดิมเป็นข้อความล้วน",
    edits.every(e => strOf(e.from) !== "old_pw") && edits.some(e => strOf(e.from) === "***"));

  ok("แก้ออเดอร์ของคนอื่นไม่ได้",
    (await call("/order/edit-info", { idToken: "token:" + OTHER, orderId: OID,
      items: [{ index: 0, gameLogin: "hacker" }] })).body.error === "ORDER_NOT_FOUND");
  ok("ค่าไม่ถูกแตะจากคนอื่น", strOf(itemsOf().gameLogin) === "new_user");

  ok("กรอกช่องว่างไม่ได้",
    (await call("/order/edit-info", { idToken: "token:" + CU, orderId: OID,
      items: [{ index: 0, gameLogin: "   " }] })).body.error === "NEED_CUSTOMER_INFO");

  // ห้ามแอบแก้ราคา/จำนวนผ่านเส้นทางนี้ (เหตุผลที่ไม่เปิดกฎ Firestore ให้เขียน orders ตรงๆ)
  await call("/order/edit-info", { idToken: "token:" + CU, orderId: OID,
    items: [{ index: 0, qty: 999, price: 1, gameLogin: "still_ok" }] });
  ok("แก้จำนวนผ่านช่องนี้ไม่ได้", numOf(itemsOf().qty) === 1, String(numOf(itemsOf().qty)));
  ok("แก้ราคาผ่านช่องนี้ไม่ได้", numOf(itemsOf().price) === 80, String(numOf(itemsOf().price)));
  ok("ยอดรวมของออเดอร์ไม่ขยับ", numOf(DOCS.get("orders/" + OID).total) === 80);

  // พอแอดมินเริ่มดำเนินการ ต้องล็อกทันที
  await call("/admin/order/start", { idToken: "token:" + AD, orderId: OID });
  ok("แอดมินเริ่มแล้ว ลูกค้าแก้ไม่ได้อีก",
    (await call("/order/edit-info", { idToken: "token:" + CU, orderId: OID,
      items: [{ index: 0, gameLogin: "too_late" }] })).body.error === "EDIT_LOCKED");
  ok("ค่ายังเป็นค่าล่าสุดก่อนล็อก", strOf(itemsOf().gameLogin) === "still_ok");
}

section("ซ่อน/เลิกซ่อนรายการในประวัติของลูกค้า");
{
  const A = "adminHide";
  CLAIMS.set(A, { admin: true });
  DOCS.set("users/" + A, F({ email: "admin@x.com", role: "admin", credit: 0 }));
  DOCS.set("users/cHide", F({ email: "c@x.com", role: "member", credit: 0 }));
  DOCS.set("orders/oDone", F({ uid: "cHide", total: 100, status: "completed", paid: true }));
  DOCS.set("orders/oOpen", F({ uid: "cHide", total: 100, status: "pending", paid: true }));
  DOCS.set("topups/tpDone", F({ uid: "cHide", amount: 50, status: "approved" }));

  let r = await call("/admin/order/hide", { idToken: "token:" + A, orderId: "oDone", hidden: true });
  ok("ซ่อนออเดอร์ที่จบแล้วได้", r.body.ok === true, JSON.stringify(r.body));
  ok("ตั้ง hiddenAt ให้จริง", !!DOCS.get("orders/oDone").hiddenAt);
  ok("ไม่ไปแตะฟิลด์อื่น (ยอดเงิน/สถานะยังอยู่)",
    DOCS.get("orders/oDone").total?.integerValue === "100"
    && DOCS.get("orders/oDone").status?.stringValue === "completed");

  r = await call("/admin/order/hide", { idToken: "token:" + A, orderId: "oDone", hidden: false });
  ok("เลิกซ่อนได้", r.body.ok === true && DOCS.get("orders/oDone").hiddenAt?.nullValue === null);

  r = await call("/admin/order/hide", { idToken: "token:" + A, orderId: "oOpen", hidden: true });
  ok("ซ่อนออเดอร์ที่ลูกค้ายังรออยู่ไม่ได้", r.body.error === "STILL_OPEN", JSON.stringify(r.body));
  ok("ออเดอร์นั้นไม่ถูกแตะเลย", DOCS.get("orders/oOpen").hiddenAt === undefined);

  r = await call("/admin/topup/hide", { idToken: "token:" + A, topupId: "tpDone", hidden: true });
  ok("ซ่อนรายการเติมเงินที่อนุมัติแล้วได้", r.body.ok === true && !!DOCS.get("topups/tpDone").hiddenAt);

  r = await call("/admin/order/hide", { idToken: "token:" + A, orderId: "ไม่มีจริง", hidden: true });
  ok("รหัสผิดรูปแบบ = BAD_REQUEST", r.body.error === "BAD_REQUEST", JSON.stringify(r.body));
  r = await call("/admin/order/hide", { idToken: "token:" + A, orderId: "oNope", hidden: true });
  ok("ไม่มีออเดอร์นั้น = NOT_FOUND", r.body.error === "NOT_FOUND", JSON.stringify(r.body));
  r = await call("/admin/order/hide", { idToken: "token:" + A, orderId: "oDone", hidden: "yes" });
  ok("hidden ต้องเป็น true/false เท่านั้น", r.body.error === "BAD_REQUEST", JSON.stringify(r.body));

  // มีคนลบออเดอร์ทิ้งหลังเซิร์ฟเวอร์อ่านค่าไปแล้ว
  // คำสั่ง update ของ Firestore จะ "สร้างให้" ถ้าไม่กันไว้ = ได้ซากเอกสารที่มีแต่ hiddenAt
  DOCS.set("orders/oRace", F({ uid: "cHide", total: 100, status: "completed", paid: true }));
  deleteAfterRead("orders/oRace");
  r = await call("/admin/order/hide", { idToken: "token:" + A, orderId: "oRace", hidden: true });
  ok("ออเดอร์ที่ถูกลบระหว่างทาง ไม่ฟื้นกลับมาเป็นซาก", !DOCS.has("orders/oRace"),
    JSON.stringify(DOCS.get("orders/oRace")));
  ok("และตอบว่าไม่สำเร็จ ไม่ใช่บอกว่าซ่อนแล้ว", r.body.ok !== true, JSON.stringify(r.body));

  // เอกสารสมาชิกก็เหมือนกัน — ถ้าฟื้นกลับมาจะได้บัญชีเปล่าที่เป็นแอดมิน
  DOCS.set("users/uRace", F({ email: "r@x.com", role: "member", credit: 0 }));
  deleteAfterRead("users/uRace");
  r = await call("/admin/role", { idToken: "token:" + A, uid: "uRace", makeAdmin: true });
  ok("สมาชิกที่ถูกลบระหว่างตั้งสิทธิ์ ไม่ฟื้นกลับมาเป็นแอดมินเปล่าๆ", !DOCS.has("users/uRace"),
    JSON.stringify(DOCS.get("users/uRace")));
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
