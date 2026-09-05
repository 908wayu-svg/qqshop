// ===== ทดสอบชั้นข้อมูล (auth.js) ทั้งบัญชีสมาชิกและแอดมิน =====
import { buildSandbox, makeDom, loadI18n, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";
import * as fauth from "./fake/auth-sdk.mjs";

buildSandbox();
makeDom("index.html");
loadI18n();

const { QQ } = await import("./sandbox/auth.mjs");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};
const section = s => console.log("\n== " + s + " ==");
const throws = async (fn, name) => {
  try { await fn(); ok(name + " (ต้อง error)", false, "ไม่ error"); return null; }
  catch (e) { ok(name, true); return e; }
};

// ---------- เตรียมข้อมูล ----------
section("สมัครสมาชิก");
await QQ.registerWithEmail("member1@test.com", "secret123", "สมชาย ใจดี", "0812345678");
await tick(5);
const m1 = store.raw("users/" + QQ.user.uid);
ok("สร้างเอกสารสมาชิกแล้ว", !!m1);
ok("ชื่อที่กรอกตอนสมัครไม่หาย", m1?.name === "สมชาย ใจดี", "ได้ " + m1?.name);
ok("เบอร์ที่กรอกตอนสมัครไม่หาย", m1?.phone === "0812345678", "ได้ " + m1?.phone);
ok("เริ่มต้น role = member", m1?.role === "member");
ok("เริ่มต้นเครดิต 0", m1?.credit === 0);
ok("ไม่ใช่แอดมิน", QQ.isAdmin === false);
const MEMBER_UID = QQ.user.uid;

section("สมาชิกห้ามแตะเครดิต/สิทธิ์ของตัวเอง");
await throws(() => QQ.updateMyProfile({ credit: 999999 }), "แก้เครดิตตัวเองไม่ได้");
await throws(() => QQ.updateMyProfile({ role: "admin" }), "ตั้งตัวเองเป็นแอดมินไม่ได้");
await throws(() => QQ.updateMyProfile({ email: "fake@x.com" }), "แก้อีเมลตัวเองไม่ได้");
await QQ.updateMyProfile({ name: "ชื่อใหม่" });
ok("แก้ชื่อตัวเองได้", store.raw("users/" + MEMBER_UID).name === "ชื่อใหม่");

section("สมาชิกอ่านข้อมูลคนอื่นไม่ได้");
store.put("users/other", { uid: "other", email: "o@x.com", name: "คนอื่น", role: "member", credit: 500 });
await throws(() => QQ.fetchUsers(), "ดึงรายชื่อสมาชิกทั้งหมดไม่ได้");
await throws(() => QQ.fetchOrders(), "ดึงออเดอร์ทั้งหมดไม่ได้");
await throws(() => QQ.fetchTopups(), "ดึงรายการเติมเงินทั้งหมดไม่ได้");
await throws(() => QQ.fetchStockItems("p1"), "อ่านคลังไอดี/รหัสผ่านไม่ได้");

section("สมาชิกสร้างออเดอร์เองไม่ได้");
store.put("products/p1", { name: "ไอดีเกม A", price: 100, stock: 5, active: true, digital: true });
store.put("products/p2", { name: "ไอดีเกม B", price: 250, stock: 2, active: true });
const prods = await QQ.fetchProducts();
ok("อ่านสินค้าได้ (ทุกคนดูได้)", prods.length === 2);
await throws(() => fs2.setDoc(fs2.doc({}, "orders", "hack1"),
  { uid: MEMBER_UID, total: 1, items: [], status: "pending" }), "เขียน orders ตรงๆ ไม่ได้");
await throws(() => QQ.saveProduct(null, { name: "ของปลอม", price: 1 }), "สร้างสินค้าเองไม่ได้");
await throws(() => QQ.setRole(MEMBER_UID, "admin"), "ตั้งสิทธิ์เองไม่ได้");

section("เติมเงิน (สมาชิก)");
const IMG = "data:image/jpeg;base64," + "A".repeat(200) + "==";
await throws(() => QQ.createTopup({ amount: 500, method: "truewallet" }), "ไม่แนบสลิป = สร้างไม่ได้");
await throws(() => QQ.createTopup({ amount: 500, method: "admin", slip: IMG }), "อ้างว่าแอดมินเติมให้ไม่ได้");
await throws(() => QQ.createTopup({ amount: 999999, method: "bank", slip: IMG }), "ยอดเกินเพดานไม่ได้");
await throws(() => QQ.createTopup({ amount: -5, method: "bank", slip: IMG }), "ยอดติดลบไม่ได้");
await throws(() => QQ.createTopup({ amount: 100, method: "bank", slip: "<img onerror=alert(1)>" }),
  "สลิปที่ไม่ใช่รูปจริงถูกปฏิเสธ");

const topupRef = await QQ.createTopup({ amount: 500, method: "truewallet", slip: IMG });
const tdoc = store.raw("topups/" + topupRef.id);
ok("สร้างคำขอเติมเงินได้", !!tdoc);
ok("เอกสาร topups ไม่มีรูป base64 ปนอยู่", !("slip" in tdoc));
ok("มีธงบอกว่าแนบสลิปไว้", tdoc.hasSlip === true);
ok("สลิปถูกเก็บแยกเอกสาร", !!store.raw("topupSlips/" + topupRef.id));
ok("สถานะเริ่มที่รออนุมัติ", tdoc.status === "pending");
ok("เครดิตยังไม่เข้าจนกว่าจะอนุมัติ", QQ.credit === 0);

// รูปแบบเก่า (สลิปฝังในเอกสาร) ต้องยังสร้างได้ ระหว่างที่หน้าเว็บเก่ายังค้างในเบราว์เซอร์ลูกค้า
{
  const { addDoc, collection } = await import("./fake/firestore.mjs");
  let okOld = true;
  try {
    await addDoc(collection({}, "topups"), { uid: MEMBER_UID, amount: 100, method: "bank",
      slip: IMG, status: "pending" });
  } catch (e) { okOld = false; }
  ok("คำขอรูปแบบเก่ายังผ่านกฎ (ไม่ทำให้ลูกค้าเดิมเติมเงินไม่ได้)", okOld);
}

const mySlip = await QQ.fetchTopupSlip(topupRef.id);
ok("เจ้าของดูสลิปตัวเองได้", mySlip === IMG);

section("ประวัติของตัวเอง เรียงใหม่ไปเก่า");
for (let i = 0; i < 5; i++) await QQ.createTopup({ amount: 10 + i, method: "bank", slip: IMG });
const mine = await QQ.fetchMyTopups(3);
ok("ได้ตามจำนวนที่ขอ", mine.length === 3, "ได้ " + mine.length);
ok("รายการล่าสุดมาก่อน", mine[0].amount === 14, "ได้ " + mine[0].amount);
store.put("topups/notmine", { uid: "other", amount: 1, method: "bank", status: "pending", hasSlip: true });
const mine2 = await QQ.fetchMyTopups(50);
ok("ไม่มีรายการของคนอื่นปน", mine2.every(x => x.uid === MEMBER_UID));

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
globalThis.__result = { pass, fail, MEMBER_UID };
if (fail) process.exitCode = 1;
