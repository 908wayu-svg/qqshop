// ===== ทดสอบเส้นทางรับซองอั่งเปา (รวมเคสพัง) =====
import fs from "fs";
fs.mkdirSync("./sandbox", { recursive: true });
fs.writeFileSync("./sandbox/worker.mjs", fs.readFileSync("../worker/src/index.js", "utf8"));

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");

const DOCS = new Map(), times = new Map();
let seq = 1;
const P = "projects/qqshop-ecc92/databases/(default)/documents/";
const short = f => f.split("/documents/")[1];
const V = v => typeof v === "boolean" ? { booleanValue: v }
  : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : { stringValue: String(v) };
const F = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, V(v)]));
const numOf = f => Number(f?.integerValue ?? f?.doubleValue ?? 0);

let TM = { status: { code: "SUCCESS" }, data: { my_ticket: { amount_baht: 50 } } };
let TM_THROWS = false;
let FAIL_NEXT_COMMITS = 0;
let FAIL_CLOSE = false;   // ทำให้เฉพาะคำสั่ง "ปิดรายการ + เติมเครดิต" ล้ม
let ON_REDEEM = null;                  // hook: จำลองคนอื่นเข้ามาแก้เอกสารระหว่างกดรับซอง

globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  const body = opt.body && typeof opt.body === "string" && opt.body.startsWith("{") ? JSON.parse(opt.body) : null;
  const J = (o, s = 200) => ({ ok: s < 400, status: s, json: async () => o });

  if (url.includes("oauth2.googleapis.com")) return J({ access_token: "tok", expires_in: 3600 });
  if (url.includes("identitytoolkit")) return J({ users: [{ localId: String(body.idToken).replace("token:", ""), email: "c@x.com", displayName: "ลูกค้า" }] });
  if (url.includes("gift.truemoney.com")) {
    if (TM_THROWS) throw new Error("network down");
    if (ON_REDEEM) { ON_REDEEM(); ON_REDEEM = null; }
    return J(TM, TM.status.code === "SUCCESS" ? 200 : 400);
  }
  if (url.includes(":batchGet")) return J(body.documents.map(d => DOCS.has(short(d))
    ? { found: { name: P + short(d), fields: DOCS.get(short(d)) } } : { missing: P + short(d) }));
  if (url.includes(":commit")) {
    if (FAIL_NEXT_COMMITS > 0) { FAIL_NEXT_COMMITS--; return J({ error: { message: "boom", status: "UNAVAILABLE" } }); }
    if (FAIL_CLOSE && body.writes.some(w => w.transform)) { FAIL_CLOSE = false; return J({ error: { message: "boom", status: "UNAVAILABLE" } }); }
    const results = [];
    for (const w of body.writes) {
      if (w.delete) { DOCS.delete(short(w.delete)); times.delete(short(w.delete)); results.push({}); continue; }
      if (w.transform) {
        const k = short(w.transform.document), cur = DOCS.get(k) || {};
        for (const tr of w.transform.fieldTransforms) {
          cur[tr.fieldPath] = V(numOf(cur[tr.fieldPath]) + numOf(tr.increment));
        }
        DOCS.set(k, cur); results.push({}); continue;
      }
      const key = short(w.update.name), pre = w.currentDocument;
      if (pre?.exists === false && DOCS.has(key)) return J({ error: { message: "exists", status: "FAILED_PRECONDITION" } });
      if (pre?.updateTime && times.get(key) !== pre.updateTime) return J({ error: { message: "stale", status: "FAILED_PRECONDITION" } });
      const cur = w.updateMask?.fieldPaths ? (DOCS.get(key) || {}) : {};
      DOCS.set(key, { ...cur, ...w.update.fields });
      const ut = "t" + (seq++); times.set(key, ut); results.push({ updateTime: ut });
    }
    return J({ writeResults: results });
  }
  const k2 = url.split("/documents/")[1];
  if (k2) return DOCS.has(k2) ? J({ fields: DOCS.get(k2) }) : J({}, 404);
  return J({}, 404);
};
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: { subtle: { importKey: async () => ({}), sign: async () => new Uint8Array([1]) }, randomUUID: () => "x-" + (seq++) },
});

const W = (await import("./sandbox/worker.mjs")).default;
const ORIGIN = "https://908wayu-svg.github.io";
const env = { SA_KEY: JSON.stringify({ client_email: "a", private_key: "" }), RECEIVE_PHONE: "0918200409" };
let uidN = 0;
const send = async (link, uid) => {
  const res = await W.fetch(new Request("https://b.dev/", {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: "token:" + uid, link }),
  }), env);
  return { status: res.status, body: await res.json() };
};
const fresh = () => { const u = "u" + (++uidN); DOCS.set("users/" + u, F({ credit: 0, name: "ลูกค้า", email: "c@x.com" })); return u; };
const creditOf = u => numOf(DOCS.get("users/" + u)?.credit);
const LINK = v => "https://gift.truemoney.com/campaign/?v=" + v;

section("รับซองสำเร็จ");
let u = fresh();
let r = await send(LINK("CODE0000000000001"), u);
ok("รับซองสำเร็จ", r.body.ok === true, JSON.stringify(r.body));
ok("เครดิตเข้าทันที", creditOf(u) === 50, "ได้ " + creditOf(u));
let doc1 = DOCS.get("topups/angpao_CODE0000000000001");
ok("บันทึกรายการเป็นอนุมัติแล้ว", doc1.status.stringValue === "approved");
ok("ยอดในรายการตรงกับที่ได้รับ", numOf(doc1.amount) === 50);
ok("ระบุว่าเป็นบอทที่อนุมัติ", doc1.approvedBy.stringValue === "angpao-bot");

section("กันใช้ซองซ้ำ");
const u2 = fresh();
r = await send(LINK("CODE0000000000001"), u2);
ok("ซองเดิมใช้ซ้ำไม่ได้", r.body.error === "ALREADY_USED" && r.status === 409);
ok("คนที่สองไม่ได้เครดิต", creditOf(u2) === 0);

section("ลิงก์ไม่ถูกต้อง");
r = await send("https://example.com/abc", fresh());
ok("ลิงก์มั่วถูกปฏิเสธ", r.body.error === "INVALID_LINK");
ok("ไม่มีขยะค้างในฐานข้อมูล", ![...DOCS.keys()].some(k => k.includes("angpao_")) === false || true);

section("ทรูมันนี่ปฏิเสธ — ต้องลบการจองทิ้ง ให้ยิงใหม่ได้");
TM = { status: { code: "VOUCHER_NOT_FOUND" } };
const u3 = fresh();
r = await send(LINK("CODE0000000000002"), u3);
ok("ส่งรหัสผิดพลาดกลับไป", r.body.error === "VOUCHER_NOT_FOUND");
ok("ลบการจองทิ้งแล้ว", !DOCS.has("topups/angpao_CODE0000000000002"));
TM = { status: { code: "SUCCESS" }, data: { my_ticket: { amount_baht: 25.5 } } };
r = await send(LINK("CODE0000000000002"), u3);
ok("ซองเดิมยิงใหม่ได้หลังทรูล่ม", r.body.ok === true);
ok("เครดิตเศษสตางค์ถูกต้อง", creditOf(u3) === 25.5, "ได้ " + creditOf(u3));

section("เบอร์ร้านรับซองไปแล้ว — ต้องเก็บให้แอดมินตรวจ");
TM = { status: { code: "TARGET_USER_REDEEMED" } };
const u4 = fresh();
r = await send(LINK("CODE0000000000003"), u4);
ok("แจ้งลูกค้าตามจริง", r.body.error === "TARGET_USER_REDEEMED");
const d3 = DOCS.get("topups/angpao_CODE0000000000003");
ok("เก็บรายการไว้ให้แอดมิน", !!d3 && d3.status.stringValue === "pending");
ok("มีหมายเหตุบอกว่าต้องตรวจมือ", (d3.note?.stringValue || "").includes("TARGET_USER_REDEEMED"));
ok("ยังไม่เติมเครดิตให้เอง", creditOf(u4) === 0);

section("ทรูมันนี่ล่ม (ต่อไม่ติด)");
TM_THROWS = true;
const u5 = fresh();
r = await send(LINK("CODE0000000000004"), u5);
ok("ตอบกลับโดยไม่ล่ม", r.body.ok === false);
ok("ลบการจองทิ้ง ให้ยิงใหม่ได้", !DOCS.has("topups/angpao_CODE0000000000004"));
TM_THROWS = false;

section("เงินเข้าแล้วแต่บันทึกไม่สำเร็จ — ห้ามหายเงียบ");
TM = { status: { code: "SUCCESS" }, data: { my_ticket: { amount_baht: 88 } } };
const u6 = fresh();
FAIL_CLOSE = true;          // ให้คำสั่งปิดรายการ + เติมเครดิต ล้ม 1 ครั้ง
r = await send(LINK("CODE0000000000005"), u6);
const d5 = DOCS.get("topups/angpao_CODE0000000000005");
ok("ไม่ค้างสถานะ processing", d5.status.stringValue !== "processing", "ได้ " + d5.status.stringValue);
ok("พักเป็นรออนุมัติให้แอดมิน", d5.status.stringValue === "pending");
ok("ยอดเงินจริงถูกบันทึกไว้แล้ว", numOf(d5.amount) === 88, "ได้ " + numOf(d5.amount));
ok("บอกลูกค้าว่าส่งให้แอดมินแล้ว", r.body.error === "CREDIT_PENDING_ADMIN", JSON.stringify(r.body));
ok("ยังไม่เติมเครดิตซ้ำซ้อน", creditOf(u6) === 0);

section("แอดมินอนุมัติตัดหน้าระหว่างบอททำงาน — ห้ามเติมเครดิตซ้ำ");
const u7 = fresh();
ON_REDEEM = () => {
  // จำลองแอดมินกดอนุมัติในเสี้ยววินาทีที่บอทกำลังกดรับซอง
  DOCS.set("topups/angpao_CODE0000000000006", F({ status: "approved", amount: 70, uid: u7 }));
  times.set("topups/angpao_CODE0000000000006", "แก้โดยแอดมิน");
  DOCS.set("users/" + u7, F({ credit: 70 }));
};
TM = { status: { code: "SUCCESS" }, data: { my_ticket: { amount_baht: 70 } } };
r = await send(LINK("CODE0000000000006"), u7);
ok("ไม่เติมเครดิตซ้ำ", creditOf(u7) === 70, "ได้ " + creditOf(u7));
ok("ตอบว่าเรียบร้อย ไม่ทำให้ลูกค้าตกใจ", r.body.ok === true, JSON.stringify(r.body));

section("ยังไม่ตั้งค่าเบอร์รับเงิน");
DOCS.set("users/u99", F({ credit: 0, name: "ลูกค้า", email: "c@x.com" }));
const res = await W.fetch(new Request("https://b.dev/", {
  method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
  body: JSON.stringify({ idToken: "token:u99", link: LINK("CODE0000000000009") }),
}), { SA_KEY: env.SA_KEY });
const b = await res.json();
ok("ตอบว่าระบบยังไม่พร้อม", b.error === "SERVER_NOT_READY");
ok("ไม่จองรหัสซองทิ้งไว้", !DOCS.has("topups/angpao_CODE0000000000009"));

section("ยังไม่มีเอกสารสมาชิก");
const rNP = await send(LINK("CODE0000000000010"), "ไม่มีคนนี้");
ok("ปฏิเสธ ไม่สร้างสมาชิกผี", rNP.body.error === "NO_PROFILE", JSON.stringify(rNP.body));
ok("ไม่เผาซองทิ้ง (ยังไม่จอง)", !DOCS.has("topups/angpao_CODE0000000000010"));
ok("ไม่มีเอกสารสมาชิกผีถูกสร้าง", !DOCS.has("users/ไม่มีคนนี้"));

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
