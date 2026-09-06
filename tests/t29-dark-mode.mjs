// ===== โหมดมืดต้องใช้งานได้จริง =====
// เดิม CSS มีชุดสีโหมดมืดครบ แต่ไม่มีอะไรตั้งค่า data-theme เลย = เป็นโค้ดที่ไม่มีวันทำงาน
// (TODO เขียนว่า "รองรับโหมดมืดแล้ว" ทั้งที่ผู้ใช้ไม่มีทางเห็น)
import fs from "fs";
import path from "path";
import { SRC } from "./harness.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");

const css = fs.readFileSync(path.join(SRC, "style.css"), "utf8");
const ui = fs.readFileSync(path.join(SRC, "ui.js"), "utf8");
const pages = fs.readdirSync(SRC).filter(f => f.endsWith(".html") && !f.startsWith("google"));

section("ทุกหน้าต้องตั้งโหมดมืดตามเครื่องผู้ใช้ ตั้งแต่ก่อนหน้าเว็บวาด");
for (const p of pages) {
  const html = fs.readFileSync(path.join(SRC, p), "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  const hasScript = /prefers-color-scheme:dark/.test(head);
  // ต้องอยู่ก่อนไฟล์ CSS ไม่งั้นหน้าจะวาดด้วยสีสว่างก่อนแล้วค่อยกระพริบเป็นมืด
  const beforeCss = head.indexOf("prefers-color-scheme:dark") < head.indexOf('href="style.css"');
  ok(p + " มีสคริปต์ตั้งโหมดมืดใน <head>", hasScript);
  if (hasScript) ok(p + " สคริปต์อยู่ก่อนไฟล์สไตล์ (ไม่กระพริบ)", beforeCss);
}

section("สคริปต์ต้องกันพังบนเบราว์เซอร์ที่ไม่รองรับ");
{
  const html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
  const m = html.match(/<script>([\s\S]*?prefers-color-scheme[\s\S]*?)<\/script>/);
  ok("หาสคริปต์เจอ", !!m);
  if (m) {
    ok("มี try/catch ครอบ", /try\s*\{[\s\S]*catch/.test(m[1]));
    // ลองรันจริงในสภาพแวดล้อมที่ไม่มี matchMedia
    const root = { dataset: {} };
    const run = new Function("document", "matchMedia", m[1]);
    let crashed = null;
    try { run({ documentElement: root }, undefined); } catch (e) { crashed = e.message; }
    ok("ไม่มี matchMedia ก็ไม่ล่ม", crashed === null, String(crashed));
    ok("และไม่ตั้งโหมดมืดมั่วๆ", root.dataset.theme === undefined);

    // เครื่องที่ตั้งโหมดมืด
    const root2 = { dataset: {} };
    new Function("document", "matchMedia", m[1])(
      { documentElement: root2 }, () => ({ matches: true }));
    ok("เครื่องตั้งโหมดมืด → เว็บเป็นโหมดมืด", root2.dataset.theme === "dark", root2.dataset.theme);

    // เครื่องที่ตั้งโหมดสว่าง
    const root3 = { dataset: {} };
    new Function("document", "matchMedia", m[1])(
      { documentElement: root3 }, () => ({ matches: false }));
    ok("เครื่องตั้งโหมดสว่าง → เว็บเป็นโหมดสว่าง", root3.dataset.theme === undefined);
  }
}

section("สลับโหมดของเครื่องระหว่างเปิดหน้าค้างไว้");
ok("ui.js คอยฟังการเปลี่ยนโหมดของเครื่อง", /addEventListener\("change"|addListener/.test(ui)
  && ui.includes("prefers-color-scheme"));
ok("เคารพการบังคับโหมดสว่างของผู้ใช้", ui.includes('dataset.theme === "light"'));

section("ชุดสีโหมดมืดต้องครบเท่าโหมดสว่าง");
{
  const grab = re => (css.match(re) || [null, ""])[1];
  const light = grab(/:root\{([\s\S]*?)\}/);
  const dark = grab(/:root\[data-theme="dark"\]\{([\s\S]*?)\}/);
  const vars = t => new Set([...t.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
  const L = vars(light), D = vars(dark);
  ok("อ่านชุดสีทั้งสองโหมดเจอ", L.size > 10 && D.size > 10, L.size + " / " + D.size);
  // ตัวแปรที่โหมดมืดไม่ได้กำหนดจะตกไปใช้ค่าของโหมดสว่าง — ต้องตั้งใจ ไม่ใช่ลืม
  const missing = [...L].filter(v => !D.has(v));
  const expected = ["--brand", "--bg", "--card", "--text", "--border", "--field"];
  ok("สีหลักที่ต้องเปลี่ยนในโหมดมืดครบ", expected.every(v => D.has(v)),
    expected.filter(v => !D.has(v)).join(", "));
  console.log("     (ตัวที่ใช้ค่าเดียวกับโหมดสว่าง: " + (missing.join(", ") || "ไม่มี") + ")");
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
