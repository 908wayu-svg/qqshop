// ===== ทดสอบตัวแยกข้อมูลจากสลิป (parseSlipText) =====
// ไม่ยิง OCR จริง (ต้องใช้ Tesseract.js + รูปจริง) แค่ป้อนข้อความตัวอย่างที่ OCR "น่าจะ" อ่านออกมา
// แล้วเช็คว่าแยกยอดเงิน/วันที่/เวลา/ชื่อผู้โอนได้ถูกต้อง
import { buildSandbox, makeDom, loadI18n, tick } from "./harness.mjs";

buildSandbox(); makeDom("admin.html"); loadI18n();
const { parseSlipText, showSlip } = await import("./sandbox/admin.mjs");

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
  ok("เลือกยอดที่มีคำว่า 'จำนวนเงิน/โอน' กำกับ ไม่ใช่ตัวเลขที่ใหญ่สุด", r.amount === 500, String(r.amount));
}

section("ยอดคงเหลือมากกว่ายอดที่โอนจริง — ห้ามหยิบยอดคงเหลือ");
{
  // เคสสำคัญ: ถ้าเลือกจากตัวเลขที่ "ใหญ่สุด" เฉยๆ จะได้ยอดคงเหลือ 5,000 ผิดไปจากยอดโอนจริง 300
  const r = parseSlipText(
    "โอนเงินสำเร็จ\nยอดคงเหลือ 5,000.00 บาท\nจำนวนเงินที่โอน 300.00 บาท\n5 ก.ย. 69 10:00"
  );
  ok("ไม่หยิบยอดคงเหลือที่มากกว่า", r.amount === 300, String(r.amount));
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

section("เปิดสลิปใหม่ก่อนสลิปเก่าจะอ่านเสร็จ — ผลของสลิปเก่าต้องไม่มาทับ");
{
  // จำลอง Tesseract: ควบคุมเองว่าแต่ละงานจะ resolve เมื่อไหร่ (ไม่พึ่ง OCR จริง/เวลาจริง)
  const pending = [];
  window.Tesseract = { recognize: () => new Promise(resolve => pending.push(resolve)) };

  const boxText = () => document.getElementById("slip-ocr").textContent;

  // เปิดสลิป A (ช้า) แล้วรีบเปิดสลิป B (ใหม่กว่า) ก่อน A จะตอบกลับ
  const pA = showSlip("data:image/png;base64,AAA=");
  await tick(3);
  const pB = showSlip("data:image/png;base64,BBB=");
  await tick(3);
  ok("มีงานอ่านสลิปสองงานค้างพร้อมกัน (A ยังไม่ทันเสร็จ)", pending.length === 2, String(pending.length));

  // B (ใบล่าสุดที่กำลังดูอยู่) เสร็จก่อน
  pending[1]({ data: { text: "จำนวนเงิน\n999.00 บาท" } });
  await pB; await tick(3);
  ok("ผลของสลิป B ที่กำลังเปิดอยู่แสดงถูกต้อง", boxText().includes("999"), boxText());

  // A (ใบเก่าที่ปิดไปแล้ว) เพิ่งเสร็จทีหลัง — ต้องไม่เอามาทับ B
  pending[0]({ data: { text: "จำนวนเงิน\n111.00 บาท" } });
  await pA; await tick(3);
  ok("ผลช้าของสลิปเก่า (A) ไม่มาทับสลิปใหม่ (B) ที่กำลังโชว์อยู่", !boxText().includes("111"), boxText());
  ok("ยังคงเห็นผลของ B เหมือนเดิม ไม่ถูกล้าง", boxText().includes("999"), boxText());

  delete window.Tesseract;
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
