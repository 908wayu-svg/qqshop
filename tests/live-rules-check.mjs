// ===== ยิงจริงกับ Firestore production ด้วยบัญชีสมาชิกธรรมดา =====
// สร้างบัญชีทดสอบชั่วคราว → ตรวจกฎความปลอดภัย → ลบทิ้งทั้งหมด
// (rules simulator ไม่จับเคส list query จึงต้องยิงจริง)
const API_KEY = "AIzaSyClU0JJzyAYUmMSpANGctMVYTcKiVt_lbY";
const PROJECT = "qqshop-ecc92";
const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");

const EMAIL = "qqtest-" + Date.now() + "@example.com";
const PASSWORD = "TestOnly!" + Math.random().toString(36).slice(2, 10);

const idp = async (path, body) => {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${path}?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
};

console.log("บัญชีทดสอบ: " + EMAIL);
const up = await idp("signUp", { email: EMAIL, password: PASSWORD, returnSecureToken: true });
if (!up.data.idToken) { console.error("สร้างบัญชีทดสอบไม่ได้", up.data); process.exit(1); }
const TOKEN = up.data.idToken, UID = up.data.localId;
console.log("uid: " + UID);

const H = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };
const V = v => v === null ? { nullValue: null }
  : typeof v === "boolean" ? { booleanValue: v }
  : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : { stringValue: String(v) };
const F = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, V(v)]));

const get = p => fetch(`${DB}/${p}`, { headers: H });
const create = (col, id, data) =>
  fetch(`${DB}/${col}?documentId=${id}`, { method: "POST", headers: H, body: JSON.stringify({ fields: F(data) }) });
const patch = (p, data, mask) =>
  fetch(`${DB}/${p}?` + Object.keys(data).map(k => "updateMask.fieldPaths=" + k).join("&"),
    { method: "PATCH", headers: H, body: JSON.stringify({ fields: F(data) }) });
const runQuery = body => fetch(`${DB}:runQuery`, { method: "POST", headers: H, body: JSON.stringify(body) });
const del = p => fetch(`${DB}/${p}`, { method: "DELETE", headers: H });

const structuredQuery = (collectionId, where) => ({
  structuredQuery: { from: [{ collectionId }], ...(where ? { where } : {}), limit: 5 },
});
const eqUid = uid => ({ fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: uid } } });

const CLEANUP = [];

try {
  section("สร้างโปรไฟล์ตัวเอง");
  let r = await create("users", UID, { uid: UID, email: EMAIL, name: "บัญชีทดสอบชั่วคราว", phone: "",
    provider: "email", role: "member", credit: 0 });
  ok("สร้างเอกสารสมาชิกของตัวเองได้", r.status === 200, r.status + " " + (await r.clone().text()).slice(0, 120));
  if (r.status === 200) CLEANUP.push("users/" + UID);

  section("สิ่งที่สมาชิกห้ามทำกับตัวเอง");
  r = await patch("users/" + UID, { credit: 999999 });
  ok("แก้เครดิตตัวเองไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await patch("users/" + UID, { role: "admin" });
  ok("ตั้งตัวเองเป็นแอดมินไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await patch("users/" + UID, { email: "hacker@example.com" });
  ok("แก้อีเมลตัวเองไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await patch("users/" + UID, { name: "ชื่อใหม่" });
  ok("แก้ชื่อตัวเองได้", r.status === 200, "HTTP " + r.status);

  section("อ่านข้อมูลคนอื่น");
  r = await runQuery(structuredQuery("users"));
  ok("ดึงรายชื่อสมาชิกทั้งหมดไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await runQuery(structuredQuery("orders"));
  ok("ดึงออเดอร์ทั้งหมดไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await runQuery(structuredQuery("topups"));
  ok("ดึงรายการเติมเงินทั้งหมดไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await runQuery(structuredQuery("topupSlips"));
  ok("ดึงสลิปทั้งหมดไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await runQuery(structuredQuery("orders", eqUid(UID)));
  ok("ดึงออเดอร์ของตัวเองได้", r.status === 200, "HTTP " + r.status);
  r = await runQuery(structuredQuery("topups", eqUid(UID)));
  ok("ดึงรายการเติมเงินของตัวเองได้", r.status === 200, "HTTP " + r.status);
  r = await runQuery(structuredQuery("orders", eqUid("someone-else-uid")));
  ok("ดึงออเดอร์ของ uid คนอื่นไม่ได้", r.status === 403, "HTTP " + r.status);
  // ===== บันทึกการกระทำของแอดมิน =====
  // แท็บ "บันทึกแอดมิน" ในหลังบ้านอ่านทั้งคอลเลกชัน (list) ไม่ใช่ทีละใบ
  // กฎ list กับ get เป็นคนละเส้นทาง และตัวจำลองกฎจับเคส list ไม่ได้ จึงต้องยิงจริง
  r = await runQuery(structuredQuery("adminLogs"));
  ok("สมาชิกไล่อ่านบันทึกแอดมินทั้งลิสต์ไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await get("adminLogs/anything");
  ok("สมาชิกเปิดบันทึกแอดมินทีละใบไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await patch("adminLogs/qqtest-fake", { action: "ปลอม" });
  ok("สมาชิกเขียนบันทึกปลอมไม่ได้", r.status === 403, "HTTP " + r.status);

  r = await runQuery(structuredQuery("settings"));
  ok("อ่านตั้งค่าร้านไม่ได้", r.status === 403, "HTTP " + r.status);

  section("คลังไอดี/รหัสผ่านของร้าน");
  const prods = await runQuery(structuredQuery("products"));
  ok("ดูสินค้าได้ (ทุกคนดูได้)", prods.status === 200, "HTTP " + prods.status);
  const list = prods.status === 200 ? await prods.json() : [];
  const anyProduct = list.find?.(x => x.document)?.document?.name?.split("/documents/")[1];
  if (anyProduct) {
    r = await runQuery({ structuredQuery: { from: [{ collectionId: "stockItems" }], limit: 5 } });
    ok("ดึงคลังรหัสผ่านแบบ collection group ไม่ได้", r.status === 403, "HTTP " + r.status);
    r = await get(anyProduct + "/stockItems/anything");
    ok("เปิดชิ้นในคลังไม่ได้", r.status === 403 || r.status === 404, "HTTP " + r.status);
  } else {
    console.log("  (ยังไม่มีสินค้าในร้าน ข้ามการตรวจคลัง)");
  }
  r = await runQuery(structuredQuery("productImages"));
  ok("ดูรูปสินค้าได้ (ทุกคนดูได้)", r.status === 200, "HTTP " + r.status);

  section("สร้างออเดอร์เอง");
  r = await create("orders", "qqtest-" + Date.now(), { uid: UID, total: 1, status: "pending" });
  ok("เขียน orders ตรงๆ ไม่ได้ (ต้องผ่านเซิร์ฟเวอร์)", r.status === 403, "HTTP " + r.status);
  r = await create("products", "qqtest-" + Date.now(), { name: "ของปลอม", price: 1 });
  ok("สร้างสินค้าเองไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await create("productImages", "qqtest-" + Date.now(), { image: "x" });
  ok("เขียนรูปสินค้าเองไม่ได้", r.status === 403, "HTTP " + r.status);

  section("คำขอเติมเงิน");
  const IMG = "data:image/jpeg;base64," + "A".repeat(64) + "==";
  const tid = "qqtest-topup-" + Date.now();
  r = await create("topups", tid + "-a", { uid: UID, amount: 5, method: "bank", status: "pending" });
  ok("ไม่มีหลักฐานแนบ = สร้างไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await create("topups", tid + "-b", { uid: UID, amount: 5, method: "admin", hasSlip: true, status: "pending" });
  ok("อ้างว่าแอดมินเติมให้ไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await create("topups", tid + "-c", { uid: UID, amount: 999999, method: "bank", hasSlip: true, status: "pending" });
  ok("ยอดเกินเพดานไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await create("topups", tid + "-d", { uid: UID, amount: 5, method: "bank", hasSlip: true, status: "approved" });
  ok("ตั้งสถานะเป็นอนุมัติแล้วเองไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await create("topups", tid + "-e", { uid: "someone-else", amount: 5, method: "bank", hasSlip: true, status: "pending" });
  ok("สร้างให้คนอื่นไม่ได้", r.status === 403, "HTTP " + r.status);

  r = await create("topupSlips", tid, { uid: UID, slip: "<script>alert(1)</script>" });
  ok("สลิปที่ไม่ใช่รูปจริงถูกปฏิเสธ", r.status === 403, "HTTP " + r.status);
  r = await create("topupSlips", tid, { uid: UID, slip: IMG });
  ok("แนบสลิปรูปจริงได้", r.status === 200, "HTTP " + r.status);
  if (r.status === 200) CLEANUP.push("topupSlips/" + tid);
  r = await create("topups", tid, { uid: UID, amount: 5, method: "bank", hasSlip: true, status: "pending" });
  ok("สร้างคำขอเติมเงินที่ถูกต้องได้", r.status === 200, "HTTP " + r.status);
  if (r.status === 200) CLEANUP.push("topups/" + tid);

  r = await patch("topups/" + tid, { status: "approved" });
  ok("แก้สถานะคำขอตัวเองไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await patch("topups/" + tid, { amount: 99999 });
  ok("แก้ยอดคำขอตัวเองไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await patch("topupSlips/" + tid, { slip: IMG.replace("A", "B") });
  ok("เปลี่ยนสลิปหลังส่งไม่ได้", r.status === 403, "HTTP " + r.status);
  r = await get("topupSlips/" + tid);
  ok("ดูสลิปของตัวเองได้", r.status === 200, "HTTP " + r.status);
  r = await del("topups/" + tid);
  ok("ลบคำขอตัวเองไม่ได้", r.status === 403, "HTTP " + r.status);

  section("index สำหรับประวัติของลูกค้า");
  const ordered = {
    structuredQuery: {
      from: [{ collectionId: "topups" }], where: eqUid(UID),
      orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }], limit: 5,
    },
  };
  r = await runQuery(ordered);
  ok("เรียงประวัติเติมเงินใหม่ไปเก่าได้ (index พร้อม)", r.status === 200,
    "HTTP " + r.status + " " + (await r.clone().text()).slice(0, 200));
  const ordered2 = JSON.parse(JSON.stringify(ordered));
  ordered2.structuredQuery.from = [{ collectionId: "orders" }];
  r = await runQuery(ordered2);
  ok("เรียงประวัติออเดอร์ใหม่ไปเก่าได้ (index พร้อม)", r.status === 200, "HTTP " + r.status);

} finally {
  section("ล้างข้อมูลทดสอบ");
  // ลบเอกสารด้วยสิทธิ์แอดมิน (firebase CLI) เพราะสมาชิกลบเองไม่ได้ตามกฎ
  const { execFileSync } = await import("child_process");
  for (const p of CLEANUP) {
    try {
      execFileSync("firebase", ["firestore:delete", p, "--project", PROJECT, "--force"],
        { stdio: "pipe", shell: true });
      console.log("  ลบแล้ว " + p);
    } catch (e) { console.log("  XX ลบไม่ได้ " + p + " — " + String(e.stderr || e).slice(0, 120)); }
  }
  const gone = await idp("delete", { idToken: TOKEN });
  console.log(gone.status === 200 ? "  ลบบัญชีทดสอบแล้ว" : "  XX ลบบัญชีทดสอบไม่ได้ " + JSON.stringify(gone.data).slice(0, 150));
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
