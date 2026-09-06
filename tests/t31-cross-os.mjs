// ===== เว็บต้องเปิดได้เหมือนกันทุกระบบปฏิบัติการ =====
// Windows ไม่สนตัวพิมพ์เล็ก/ใหญ่ในชื่อไฟล์ แต่ Linux (เครื่องที่ GitHub Pages ใช้จริง) สนมาก
// พิมพ์ Logo.svg แทน logo.svg บนเครื่องเราจะเปิดได้ปกติ แต่ของจริงจะขึ้นรูปแตก 404
// เทสนี้จึงเทียบชื่อไฟล์แบบตรงตัวอักษรเป๊ะ ไม่ใช้ existsSync (ซึ่งบน Windows ก็ยังผ่าน)
import fs from "fs";
import path from "path";
import { SRC } from "./harness.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");

const files = fs.readdirSync(SRC).filter(f => fs.statSync(path.join(SRC, f)).isFile());
const exact = new Set(files);
const lower = new Map();
for (const f of files) (lower.get(f.toLowerCase()) || lower.set(f.toLowerCase(), []).get(f.toLowerCase())).push(f);

const htmls = files.filter(f => f.endsWith(".html"));
const isLocal = u => u && !/^(https?:|data:|mailto:|tel:|javascript:|#|\/\/)/.test(u);
const clean = u => u.split("#")[0].split("?")[0].replace(/^\.\//, "");

section("ไฟล์ทุกไฟล์ที่หน้าเว็บเรียกใช้ ต้องมีอยู่จริง (ตัวพิมพ์ตรงเป๊ะ)");
let refs = 0, missing = [];
for (const h of htmls) {
  const src = fs.readFileSync(path.join(SRC, h), "utf8");
  for (const m of src.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const u = clean(m[1]);
    if (!isLocal(u) || !u) continue;
    refs++;
    if (!exact.has(u)) missing.push(h + " → " + u);
  }
}
ok("ตรวจลิงก์ในหน้า HTML " + refs + " จุด", refs > 20, "เจอแค่ " + refs + " จุด (น้อยผิดปกติ)");
ok("ไม่มีไฟล์ที่หาไม่เจอ", missing.length === 0, missing.join(" · "));

section("ไฟล์ที่ CSS เรียกใช้ก็ต้องมีจริงเหมือนกัน");
{
  const css = fs.readFileSync(path.join(SRC, "style.css"), "utf8");
  const bad = [];
  let n = 0;
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const u = clean(m[1].trim());
    if (!isLocal(u) || !u) continue;
    n++;
    if (!exact.has(u)) bad.push(u);
  }
  ok("ตรวจ url() ใน CSS " + n + " จุด ครบทุกไฟล์", bad.length === 0, bad.join(", "));
}

section("รูปที่โค้ด JS เรียกใช้ ต้องมีจริง");
{
  const bad = [];
  for (const f of files.filter(x => x.endsWith(".js"))) {
    const code = fs.readFileSync(path.join(SRC, f), "utf8");
    for (const m of code.matchAll(/["'`]([\w-]+\.(?:png|jpg|jpeg|svg|webp|gif|jfif))["'`]/g)) {
      if (!exact.has(m[1])) bad.push(f + " → " + m[1]);
    }
  }
  ok("ไม่มีรูปที่หาไม่เจอในโค้ด", bad.length === 0, bad.join(" · "));
}

section("ห้ามมีไฟล์ที่ต่างกันแค่ตัวพิมพ์เล็ก/ใหญ่");
// บน Linux เป็นคนละไฟล์ บน Windows/macOS เป็นไฟล์เดียวกัน — git จะสับสนจนไฟล์หาย
{
  const dupes = [...lower.values()].filter(v => v.length > 1);
  ok("ชื่อไฟล์ไม่ชนกัน", dupes.length === 0, dupes.map(v => v.join(" / ")).join(" · "));
}

section("ชื่อไฟล์ต้องใช้ได้บนทุกระบบ");
// Windows ห้าม < > : \" | ? * และห้ามชื่อสงวน (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
// ถ้ามีไฟล์แบบนี้ใน repo คน clone บน Windows จะ checkout ไม่ผ่านทั้ง repo
{
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
  const bad = files.filter(f => /[<>:"|?*]/.test(f) || RESERVED.test(f) || f.endsWith(".") || f.endsWith(" "));
  ok("ไม่มีชื่อไฟล์ต้องห้ามของ Windows", bad.length === 0, bad.join(", "));
}

section("ไฟล์ที่เว็บใช้จริง ห้ามมีช่องว่างหรืออักษรที่ต้อง encode ใน URL");
{
  const used = new Set();
  for (const h of htmls) {
    const src = fs.readFileSync(path.join(SRC, h), "utf8");
    for (const m of src.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const u = clean(m[1]);
      if (isLocal(u) && u) used.add(u);
    }
  }
  const bad = [...used].filter(u => !/^[A-Za-z0-9._/-]+$/.test(u));
  ok("ลิงก์ในเว็บใช้ตัวอักษรปลอดภัยทั้งหมด", bad.length === 0, bad.join(", "));
}

section("ไฟล์ข้อความต้องขึ้นบรรทัดใหม่แบบ LF และเป็น UTF-8 ไม่มี BOM");
// CRLF ใน .sh/.json ทำให้บางเครื่องมือบน Linux พัง ส่วน BOM ทำให้ JSON.parse ล้ม
// และทำให้บรรทัดแรกของ HTML มีอักขระล่องหนก่อน <!doctype>
{
  const texts = files.filter(f => /\.(html|css|js|json|md|txt|xml|rules)$/.test(f));
  const bom = [], crlf = [];
  for (const f of texts) {
    const b = fs.readFileSync(path.join(SRC, f));
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) bom.push(f);
    if (b.includes(0x0D)) crlf.push(f);
  }
  ok("ไม่มีไฟล์ที่ขึ้นต้นด้วย BOM", bom.length === 0, bom.join(", "));
  ok("ไม่มีไฟล์ที่ใช้ CRLF", crlf.length === 0, crlf.join(", "));
}

section("โค้ดต้องไม่ผูกกับพาธแบบ Windows");
// พาธแบบ C:\... หรือ \ คั่นโฟลเดอร์ จะพังทันทีบน Linux/macOS
{
  const bad = [];
  for (const f of files.filter(x => /\.(js|json|html)$/.test(x))) {
    const code = fs.readFileSync(path.join(SRC, f), "utf8");
    // ต้องมีเครื่องหมายคำพูดนำหน้า ไม่งั้นจะไปจับ https:// ด้วย
    if (/["'`][A-Za-z]:[\\/]/.test(code)) bad.push(f);
  }
  ok("ไม่มีพาธเฉพาะ Windows ในโค้ดเว็บ", bad.length === 0, bad.join(", "));
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
