// ===== ปุ่มคัดลอกต้องทำงานจริงบนทุกเบราว์เซอร์ =====
// เคยพังมาแล้วสองแบบ:
//   1. วาดปุ่มไว้แต่ไม่มีใครรับคลิก = กดแล้วไม่เกิดอะไรขึ้น
//   2. เบราว์เซอร์เก่า/หน้าเว็บที่ไม่ใช่ https ไม่มี navigator.clipboard = ต้องมีทางสำรอง
// และปุ่มต้องกดรัวๆ ได้โดยป้ายบนปุ่มไม่เพี้ยนค้าง
import fs from "fs";
import path from "path";
import { buildSandbox, makeDom, loadI18n, tick, SRC } from "./harness.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");

buildSandbox(); makeDom("purchases.html"); loadI18n();   // loadI18n โหลด ui.js ให้ด้วย

// jsdom ไม่มีคลิปบอร์ดจริง จึงต่อของปลอมไว้ดูว่าโค้ดเรียกอะไร
let clipboard = [], clipboardFails = false, execCalls = 0, execResult = true;
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText: async s => { if (clipboardFails) throw new Error("ไม่อนุญาต"); clipboard.push(s); } },
});
document.execCommand = () => { execCalls++; return execResult; };

const mkBtn = (label, value) => {
  const b = document.createElement("button");
  b.className = "copy";
  b.textContent = label;
  if (value !== undefined) b.dataset.copy = value;
  document.body.appendChild(b);
  return b;
};
const click = async b => { b.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await tick(4); };

section("กดคัดลอกแล้วข้อความเข้าคลิปบอร์ด");
const b1 = mkBtn("คัดลอก", "PASSWORD-123");
await click(b1);
ok("ข้อความถูกคัดลอก", clipboard.at(-1) === "PASSWORD-123", JSON.stringify(clipboard));
ok("ปุ่มบอกว่าสำเร็จ", b1.textContent === "✓", b1.textContent);

section("ปุ่มกลับเป็นป้ายเดิมหลังผ่านไปครู่หนึ่ง");
await new Promise(r => setTimeout(r, 1400));
ok("ป้ายกลับมาเป็นคำเดิม", b1.textContent === "คัดลอก", b1.textContent);
ok("ไม่ทิ้งขยะไว้ในแอตทริบิวต์", b1.dataset.copyLabel === undefined, String(b1.dataset.copyLabel));

section("กดรัวๆ ป้ายต้องไม่ค้างเป็นเครื่องหมายถูก");
// เดิมครั้งที่สองจะจำ \"✓\" เป็นป้ายเดิม แล้วปุ่มค้างเป็น ✓ ตลอดไป
await click(b1); await click(b1); await click(b1);
await new Promise(r => setTimeout(r, 1400));
ok("ป้ายยังเป็นคำเดิม", b1.textContent === "คัดลอก", b1.textContent);

section("เบราว์เซอร์ที่คลิปบอร์ดใช้ไม่ได้ ต้องมีทางสำรอง");
clipboardFails = true; execCalls = 0;
const b2 = mkBtn("คัดลอก", "FALLBACK-1");
await click(b2);
ok("ถอยไปใช้วิธีสำรอง", execCalls === 1, "เรียก execCommand " + execCalls + " ครั้ง");
ok("ยังบอกว่าสำเร็จ", b2.textContent === "✓", b2.textContent);
ok("ไม่มี textarea ชั่วคราวค้างในหน้า", document.querySelectorAll("textarea").length === 0);

section("ถ้าคัดลอกไม่ได้จริงๆ ต้องบอกผู้ใช้ ไม่ใช่เงียบ");
execResult = false;
const b3 = mkBtn("คัดลอก", "NOPE-1");
await click(b3);
ok("ปุ่มบอกว่าคัดลอกไม่ได้", b3.textContent === "✕", b3.textContent);

section("ปุ่มที่ไม่มีข้อความให้คัดลอก ต้องไม่ทำอะไรเลย");
execResult = true; clipboardFails = false;
const b4 = mkBtn("คัดลอก");           // ไม่มี data-copy
await click(b4);
ok("ป้ายไม่เปลี่ยน", b4.textContent === "คัดลอก", b4.textContent);
const before = clipboard.length;
const b5 = mkBtn("คัดลอก", "");        // data-copy ว่าง = ไม่มีอะไรให้คัดลอก
await click(b5);
ok("ไม่คัดลอกสตริงว่าง", clipboard.length === before, "คลิปบอร์ดโตขึ้น");
ok("ป้ายไม่เปลี่ยน (ปุ่มแบบนี้ไม่ควรถูกวาดตั้งแต่แรก)", b5.textContent === "คัดลอก", b5.textContent);

section("ห้ามวาดปุ่มคัดลอกที่ไม่มีค่าให้คัดลอก");
// ปุ่มที่กดแล้วไม่เกิดอะไรเลยทำให้ลูกค้าคิดว่าเว็บพัง — ทุกที่ที่วาดปุ่มต้องเช็คว่ามีค่าก่อน
for (const f of ["purchases.js", "wallet.js", "admin.js"]) {
  const code = fs.readFileSync(path.join(SRC, f), "utf8");
  const bad = code.split(String.fromCharCode(10))
    .map((l, i) => [i + 1, l])
    // เงื่อนไขอาจอยู่บรรทัดก่อนหน้า (เทมเพลตหลายบรรทัด) จึงดูย้อนขึ้นไป 2 บรรทัด
    .filter(([n, l]) => l.includes('class="copy"')
      && !code.split(String.fromCharCode(10)).slice(Math.max(0, n - 3), n).join(" ").includes("?"));
  ok(f + " วาดปุ่มคัดลอกเฉพาะเมื่อมีค่า", bad.length === 0,
    bad.map(([n]) => "บรรทัด " + n).join(", "));
}

section("คลิกที่ไอคอนข้างในปุ่มก็ต้องติด");
const b6 = mkBtn("", "INNER-1");
const span = document.createElement("span");
span.textContent = "📋";
b6.appendChild(span);
span.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await tick(4);
ok("คลิกลูกในปุ่มก็คัดลอกได้", clipboard.at(-1) === "INNER-1", JSON.stringify(clipboard.at(-1)));

section("คลิกที่อื่นในหน้าต้องไม่ไปยุ่งกับคลิปบอร์ด");
const n = clipboard.length;
document.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await tick(4);
ok("ไม่มีอะไรถูกคัดลอกเพิ่ม", clipboard.length === n);

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
