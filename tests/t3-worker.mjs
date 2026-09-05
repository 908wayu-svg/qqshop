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
let FAIL_COMMIT = 0;

globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  const body = opt.body && typeof opt.body === "string" && opt.body.startsWith("{") ? JSON.parse(opt.body) : null;
  const J = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });

  if (url.includes("oauth2.googleapis.com/token")) return J({ access_token: "tok", expires_in: 3600 });
  if (url.includes("identitytoolkit")) {
    if (body?.idToken === "bad") return J({});
    return J({ users: [{ localId: String(body.idToken).replace("token:", ""), email: "c@x.com", displayName: "ลูกค้า" }] });
  }
  if (url.includes(":batchGet")) {
    return J(body.documents.map(d => {
      const key = short(d);
      return DOCS.has(key) ? { found: { name: P + key, fields: DOCS.get(key) } } : { missing: P + key };
    }));
  }
  if (url.includes(":commit")) {
    if (FAIL_COMMIT > 0) { FAIL_COMMIT--; return J({ error: { message: "boom", status: "UNAVAILABLE" } }); }
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
    randomUUID: () => "aaaaaaaa-bbbb-cccc-dddd-" + String(updateSeq++).padStart(12, "0"),
  },
});

const W = (await import("./sandbox/worker.mjs")).default;
const ORIGIN = "https://908wayu-svg.github.io";
const env = { SA_KEY: JSON.stringify({ client_email: "x@y", private_key: "" }), RECEIVE_PHONE: "0918200409" };
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

section("สั่งซื้อ — ราคาคิดจากฐานข้อมูล");
resetDb();
let u = freshUid(); withUser(u);
let r = await call("/order", { idToken: "token:" + u, items: [{ id: "p1", qty: 2, price: 1, name: "ของถูก" }] });
ok("สั่งซื้อสำเร็จ", r.body.ok === true, JSON.stringify(r.body));
ok("ยอดคิดจากราคาจริง ไม่ใช่ราคาที่ส่งมา", r.body.total === 600, "ได้ " + r.body.total);
const oKey = [...DOCS.keys()].find(k => k.startsWith("orders/"));
ok("บันทึกออเดอร์ลงฐานข้อมูล", !!oKey);
ok("สถานะเริ่มที่ pending", DOCS.get(oKey).status.stringValue === "pending");
ok("ชื่อสินค้าเอามาจากฐานข้อมูล", DOCS.get(oKey).items.arrayValue.values[0].mapValue.fields.name.stringValue === "ไอดีเกม A");
ok("ยังไม่หักเครดิตตอนสั่ง", DOCS.get("users/" + u).credit.integerValue === "1000");

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

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
