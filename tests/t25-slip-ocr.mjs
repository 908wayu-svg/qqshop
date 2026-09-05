// ===== ทดสอบตัวแยกข้อมูลจากสลิป (parseSlipText) =====
// ไม่ยิง OCR จริง (ต้องใช้ Tesseract.js + รูปจริง) แค่ป้อนข้อความตัวอย่างที่ OCR "น่าจะ" อ่านออกมา
// แล้วเช็คว่าแยกยอดเงิน/วันที่/เวลา/ชื่อผู้โอนได้ถูกต้อง
import { buildSandbox, makeDom, loadI18n } from "./harness.mjs";

buildSandbox(); makeDom("admin.html"); loadI18n();
const { parseSlipText } = await import("./sandbox/admin.mjs");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");

section("สลิปธนาคาร (รูปแบบทั่วไป)");
{
  const r = parseSlipText(
    "โอนเงินสำเร็จ\nจาก นายวายุ พลศิริ\nธ.กสิกรไทย xxx-x-x1234-x\nไปยัง QQSHOP\n" +
    "จำนวนเงิน\n100.00 บาท\n5 ก.ย. 69 14:32 น.\nรหัสอ้างอิง 00123456789"
  );
  ok("อ่านยอดเงินถูก", r.amount === 100, String(r.amount));
  ok("อ่านวันที่ถูก", r.date === "5 ก.ย. 69", r.date);
  ok("อ่านเวลาถูก", r.time === "14:32", r.time);
  ok("อ่านชื่อผู้โอนถูก", r.senderName === "นายวายุ พลศิริ", r.senderName);
}

section("สลิปทรูมันนี่ (เดือนเต็ม, เวลามีวินาที)");
{
  const r = parseSlipText(
    "TrueMoney Wallet\nโอนเงินสำเร็จ\nFrom: Somsak T.\n1,250.50 บาท\n" +
    "05/09/2569 09:07:15\nหมายเลขทำรายการ 987654321"
  );
  ok("อ่านยอดเงินที่มีจุลภาคถูก", r.amount === 1250.5, String(r.amount));
  ok("อ่านวันที่แบบตัวเลขล้วนถูก", r.date === "05/09/2569", r.date);
  ok("อ่านเวลาที่มีวินาทีถูก (ตัดวินาทีในผลลัพธ์)", r.time.startsWith("09:07"), r.time);
  ok("อ่านชื่อผู้โอนภาษาอังกฤษถูก", r.senderName === "Somsak T.", r.senderName);
}

section("มีตัวเลขหลายตัวปนกัน — ต้องไม่หยิบเลขผิด");
{
  const r = parseSlipText(
    "เลขที่บัญชี 123-4-56789-0\nยอดคงเหลือ 50.25 บาท\nจำนวนเงินที่โอน 500.00 บาท\n" +
    "ค่าธรรมเนียม 0.00 บาท\n1 ต.ค. 68"
  );
  ok("เลือกยอดเงินที่มากที่สุด (กันหยิบยอดคงเหลือ/ค่าธรรมเนียมผิด)", r.amount === 500, String(r.amount));
}

section("ข้อความอ่านไม่ออก / OCR ล้มเหลวบางส่วน");
{
  const r = parseSlipText("");
  ok("ข้อความว่าง = ไม่มีอะไรให้อ่าน ไม่ throw", r.amount === null && r.date === null
    && r.time === null && r.senderName === null);

  const r2 = parseSlipText("ภาพเบลอ อ่านไม่ออก xyz 123");
  ok("ไม่มีทศนิยม 2 ตำแหน่ง = ไม่เดายอดเงินมั่วๆ", r2.amount === null, String(r2.amount));
  ok("ไม่มีรูปแบบวันที่ = ไม่มีวันที่", r2.date === null, r2.date);

  const r3 = parseSlipText(null);
  ok("รับค่า null ได้โดยไม่ throw", r3.amount === null);
}

section("ไม่มีชื่อผู้โอนในข้อความ");
{
  const r = parseSlipText("โอนเงินสำเร็จ\n200.00 บาท\n2 ธ.ค. 67 08:00");
  ok("ไม่มีคำว่าจาก/From ก็ไม่เดาชื่อ", r.senderName === null);
  ok("แต่ยังอ่านยอด/วันที่/เวลาได้ตามปกติ",
    r.amount === 200 && r.date === "2 ธ.ค. 67" && r.time === "08:00");
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
