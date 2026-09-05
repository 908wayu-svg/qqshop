// ===== ทดสอบหน้ากระเป๋าเงิน / เติมเงิน =====
import { buildSandbox, makeDom, loadI18n, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";

buildSandbox(); const dom = makeDom("wallet.html"); loadI18n();
window.QRCode = globalThis.QRCode = function (box) { box.innerHTML = "<canvas></canvas>"; };   // ไลบรารี QR โหลดจาก CDN
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

// ---------- บอทจำลอง ----------
let BOT = { ok: true, amount: 50 };
let BOT_THROWS = false;
globalThis.fetch = async () => {
  if (BOT_THROWS) throw new Error("offline");
  return { ok: true, json: async () => BOT };
};

await QQ.registerWithEmail("wallet@test.com", "secret123", "เจ้าของกระเป๋า", "0800000000");
await tick(6);
const UID = QQ.user.uid;
store.state.docs.set("users/" + UID, { ...store.raw("users/" + UID), credit: 250 });
fs2.notifyAll();

await import("./sandbox/wallet.mjs");
await tick(12);

section("หน้าจอเริ่มต้น");
ok("เปิดหน้าให้คนที่ล็อกอินแล้ว", !$("page").classList.contains("hidden"));
ok("แสดงเครดิตปัจจุบัน", $("credit-big").textContent.includes("250"), $("credit-big").textContent);
ok("มีช่องทางเติมเงินครบ 4 ช่อง", $("method-grid").querySelectorAll(".method").length === 4);

section("ช่องทางโอน/สลิป");
click([...$("method-grid").querySelectorAll(".method")].find(b => b.dataset.method === "bank"));
await tick(2);
ok("แสดงเลขบัญชี", $("method-info").innerHTML.includes("1811180633"));
ok("แสดงชื่อบัญชี", $("method-info").innerHTML.includes("วายุ"));
ok("ขอให้แนบสลิป", !$("slip-box").classList.contains("hidden"));
ok("ซ่อนช่องลิงก์ซอง", $("angpao-box").classList.contains("hidden"));
ok("มีปุ่มคัดลอก", $("method-info").querySelector(".copy") !== null);

section("พร้อมเพย์");
click([...$("method-grid").querySelectorAll(".method")].find(b => b.dataset.method === "promptpay"));
await tick(2);
ok("สร้าง QR ได้", $("qr-canvas")?.querySelector("canvas") !== null);
const { promptPayPayload } = await import("./sandbox/promptpay.mjs");
const payload = promptPayPayload("0918200409", 100, "QQSHOP");
ok("payload ขึ้นต้นถูกมาตรฐาน EMV", payload.startsWith("000201"));
ok("payload ระบุสกุลเงินบาท", payload.includes("5303764"));
ok("payload มียอดเงิน", payload.includes("54") && payload.includes("100.00"));
ok("payload ลงท้ายด้วย CRC 4 หลัก", /6304[0-9A-F]{4}$/.test(payload), payload.slice(-8));
ok("เบอร์ถูกแปลงเป็นรูปแบบสากล", payload.includes("0066918200409"));

section("ส่งคำขอเติมเงิน");
click([...$("method-grid").querySelectorAll(".method")].find(b => b.dataset.method === "truewallet"));
await tick(2);
$("amount").value = "";
await window.submitTopup();
await tick(3);
ok("ไม่ใส่ยอด = เตือน", $("msg").textContent.includes("จำนวนเงิน") || $("msg").textContent.includes("ไม่ถูกต้อง"), $("msg").textContent);

$("amount").value = "500";
await window.submitTopup();
await tick(3);
ok("ไม่แนบสลิป = เตือน", $("msg").textContent.includes("สลิป"), $("msg").textContent);
ok("ยังไม่มีคำขอถูกสร้าง", ![...store.state.docs.keys()].some(k => k.startsWith("topups/")));

section("ซองอั่งเปา (บอทเปิดอยู่)");
click([...$("method-grid").querySelectorAll(".method")].find(b => b.dataset.method === "angpao"));
await tick(2);
ok("ซ่อนช่องแนบสลิป", $("slip-box").classList.contains("hidden"));
ok("ซ่อนช่องกรอกยอด (บอทอ่านเอง)", $("amount-box").classList.contains("hidden"));
ok("ปุ่มเปลี่ยนเป็น 'รับซองอั่งเปา'", $("submit-btn").textContent.includes("รับซอง"));

$("angpao").value = "ลิงก์มั่ว";
await window.submitTopup();
await tick(3);
ok("ลิงก์ผิดถูกเตือน", $("msg").textContent.includes("ไม่ถูกต้อง"), $("msg").textContent);

$("angpao").value = "https://gift.truemoney.com/campaign/?v=ABCDEF1234567890";
BOT = { ok: true, amount: 75.5 };
await window.submitTopup();
await tick(6);
ok("รับซองสำเร็จ แจ้งยอดที่ได้", $("msg").textContent.includes("75.5"), $("msg").textContent);
ok("ล้างช่องลิงก์ให้", $("angpao").value === "");

BOT = { ok: false, error: "ALREADY_USED" };
$("angpao").value = "https://gift.truemoney.com/campaign/?v=ABCDEF1234567890";
await window.submitTopup();
await tick(6);
ok("ซองถูกใช้แล้ว = แปลเป็นภาษาคน", $("msg").textContent.includes("ถูกใช้ไปแล้ว"), $("msg").textContent);
ok("ไม่ล้างลิงก์ทิ้ง (ลูกค้าอาจต้องใช้อ้างอิง)", $("angpao").value !== "");

BOT = { ok: false, error: "CREDIT_PENDING_ADMIN", amount: 40 };
await window.submitTopup();
await tick(6);
ok("รับซองได้แต่เติมไม่สำเร็จ = บอกว่าส่งให้แอดมินแล้ว", $("msg").textContent.includes("แอดมิน"), $("msg").textContent);
ok("ล้างลิงก์ กันลูกค้ายิงซ้ำ", $("angpao").value === "");

BOT_THROWS = true;
$("angpao").value = "https://gift.truemoney.com/campaign/?v=ZZZZZZ1234567890";
await window.submitTopup();
await tick(6);
ok("บอทติดต่อไม่ได้ = ไม่ค้างปุ่ม", $("submit-btn").disabled === false);
ok("แจ้งว่าติดต่อระบบไม่ได้", $("msg").textContent.includes("ติดต่อ"), $("msg").textContent);
BOT_THROWS = false;

section("ประวัติเติมเงิน");
store.put("topups/h1", { uid: UID, amount: 100, method: "bank", status: "approved", hasSlip: true, createdAt: new fs2.Timestamp(Date.now() - 5000) });
store.put("topups/h2", { uid: UID, amount: 60, method: "angpao", status: "processing", createdAt: new fs2.Timestamp(Date.now() - 3000) });
store.put("topups/h3", { uid: UID, amount: 20, method: "admin", status: "rejected", note: "สลิปซ้ำ", createdAt: new fs2.Timestamp(Date.now() - 1000) });
store.put("topups/hx", { uid: "someone-else", amount: 9999, method: "bank", status: "approved", hasSlip: true, createdAt: new fs2.Timestamp(Date.now()) });
document.dispatchEvent(new window.CustomEvent("langchange"));
await tick(8);
const html = $("table-topups").innerHTML;
ok("เห็นรายการของตัวเอง", html.includes("100") && html.includes("60"));
ok("ไม่เห็นของคนอื่น", !html.includes("9,999"));
ok("สถานะ 'กำลังดำเนินการ' แปลได้ ไม่โชว์ st_processing", html.includes("กำลังดำเนินการ") && !html.includes("st_processing"));
ok("แสดงหมายเหตุตอนถูกปฏิเสธ", html.includes("สลิปซ้ำ"));
ok("แสดงช่องทาง 'แอดมินเพิ่มให้'", html.includes("แอดมินเพิ่มให้"));

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
