// ===== ทดสอบหน้าเงื่อนไขการให้บริการ / การคืนสินค้า (terms.html) =====
// จุดที่พังง่าย:
//  - แก้ระยะเวลาเคลมใน shop-config แล้วหน้าเว็บยังโชว์เลขเก่า (เขียนตัวเลขตายไว้ในหน้า)
//  - ตัวเลขเปลี่ยนแค่บล็อกภาษาเดียว อีกภาษายังเป็นเลขเก่า
//  - สลับภาษาแล้วโชว์ทั้งสองภาษาพร้อมกัน หรือหายไปทั้งคู่
//  - ลิงก์ติดต่อแอดมินไม่ได้ดึงจาก shop-config เลยชี้ไปที่ # ค้างไว้
import { buildSandbox, makeDom, loadI18n, tick, SRC } from "./harness.mjs";
import fs from "fs";
import path from "path";

buildSandbox(); makeDom("terms.html"); loadI18n();

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const block = lang => document.querySelector(`[data-lang-block="${lang}"]`);
const textOf = lang => block(lang).textContent.replace(/\s+/g, " ");

const { SHOP } = await import("./sandbox/shop-config.mjs");

// สคริปต์ในหน้าเป็น <script type="module"> ฝังไว้ jsdom ไม่รันให้ จึงรันตรรกะเดียวกันเองที่นี่
// (คัดลอกมาจาก terms.html — ถ้าแก้ในหน้า ต้องแก้ตรงนี้ให้ตรงกัน)
const fb = (SHOP.contact?.channels || []).find(c => c.id === "facebook" && c.enabled !== false);
for (const id of ["policy-contact-th", "policy-contact-en"]) {
  const a = $(id);
  if (!a) continue;
  if (fb) a.href = fb.url; else a.closest(".card")?.remove();
}
for (const el of document.querySelectorAll("[data-policy]")) {
  const v = SHOP.policy?.[el.dataset.policy];
  if (v != null) el.textContent = v;
}
function applyPolicyLang() {
  const lang = getLang();
  document.querySelectorAll("[data-lang-block]").forEach(el => { el.hidden = el.dataset.langBlock !== lang; });
}
applyPolicyLang();
document.addEventListener("langchange", applyPolicyLang);

section("โครงหน้า");
ok("มีบล็อกภาษาไทย", !!block("th"));
ok("มีบล็อกภาษาอังกฤษ", !!block("en"));
ok("เปิดหน้ามาเห็นภาษาไทย", block("th").hidden === false);
ok("ภาษาอังกฤษซ่อนอยู่ ไม่โชว์ซ้อนกัน", block("en").hidden === true);
ok("หัวเว็บมีปุ่มกลับหน้าร้าน",
  [...document.querySelectorAll("header a")].some(a => a.getAttribute("href") === "index.html"));
ok("โยงไปหน้านโยบายความเป็นส่วนตัวได้",
  [...document.querySelectorAll('a[href="privacy.html"]')].length >= 2, "เจอ " +
  document.querySelectorAll('a[href="privacy.html"]').length + " ลิงก์");

section("ระยะเวลาเคลมต้องมาจาก shop-config.js ที่เดียว");
{
  const spots = [...document.querySelectorAll('[data-policy="claimMinutes"]')];
  ok("มีจุดที่ใส่ตัวเลขไว้", spots.length >= 2, "เจอ " + spots.length + " จุด");
  ok("ทุกจุดใช้เลขเดียวกับใน shop-config",
    spots.every(el => el.textContent === String(SHOP.policy.claimMinutes)),
    spots.map(el => el.textContent).join(","));
  ok("ทั้งไทยและอังกฤษมีตัวเลขนี้",
    textOf("th").includes(String(SHOP.policy.claimMinutes)) &&
    textOf("en").includes(String(SHOP.policy.claimMinutes)));
  ok("ตั้งค่า SHOP.policy.claimMinutes ไว้จริง (ไม่ใช่ค่าว่าง)",
    Number(SHOP.policy?.claimMinutes) > 0, String(SHOP.policy?.claimMinutes));
  // เงื่อนไขวิดีโอเป็นหัวใจของนโยบายเคลมรอบนี้ ถ้าหายไปจากหน้า = ร้านเคลมอะไรไม่ได้เลย
  ok("บอกว่าต้องอัดวิดีโอ (ไทย)", textOf("th").includes("อัดวิดีโอ"));
  ok("บอกว่าไม่มีวิดีโอเคลมไม่ได้ (ไทย)", textOf("th").includes("ไม่มีวิดีโอ"));
  ok("บอกว่าต้องอัดวิดีโอ (อังกฤษ)", /record a video/i.test(textOf("en")));
  ok("บอกว่าไม่มีวิดีโอเคลมไม่ได้ (อังกฤษ)", /No video means no refund/i.test(textOf("en")));
  ok("บอกว่านับเวลาเป็นนาที ไม่ใช่ชั่วโมง (ไทย)", textOf("th").includes("นาที") && !/d+ ชั่วโมง/.test(textOf("th")));
}

section("เนื้อหาที่ร้านขายของออนไลน์ต้องมี (ไทย)");
{
  const th = textOf("th");
  for (const [name, kw] of [
    ["บอกว่าจ่ายด้วยเครดิต", "เครดิต"],
    ["บอกว่าเครดิตหักทันทีที่กดยืนยัน", "หักทันทีที่กดยืนยัน"],
    ["บอก 3 สถานะของออเดอร์เติมเกม", "กำลังดำเนินการ"],
    ["บอกว่าแก้ข้อมูลเองได้ตอนรอดำเนินการ", "รอดำเนินการ"],
    ["บอกว่าได้ของเมื่อไหร่", "ประวัติการซื้อ"],
    ["มีหัวข้อเคลม/คืนเครดิต", "คืนเป็นเครดิต"],
    ["ระบุกรณีที่ไม่รับประกัน", "ไม่รับประกัน"],
    ["พูดถึงเครดิตไม่มีวันหมดอายุ", "ไม่มีวันหมดอายุ"],
    ["มีข้อห้าม (สลิปปลอม)", "สลิปปลอม"],
    ["มีข้อจำกัดความรับผิด", "ไม่เกินยอดเงินที่คุณจ่าย"],
    ["บอกวันที่ปรับปรุงล่าสุด", "ปรับปรุงล่าสุด"],
  ]) ok(name, th.includes(kw), kw);
  ok("สัญญาว่าส่งของไม่ได้ต้องคืนเครดิตเต็มจำนวน", th.includes("ส่งมอบของไม่ได้"));
  ok("เตือนให้ลูกค้าเปลี่ยนรหัสผ่านหลังเติมเสร็จ", th.includes("เปลี่ยนรหัสผ่านของคุณเอง"));
}

section("เนื้อหาภาษาอังกฤษต้องครบเท่ากัน");
{
  const en = textOf("en");
  for (const [name, kw] of [
    ["ordering & payment", "credit"],
    ["delivery", "Purchase history"],
    ["refund", "refund the full amount"],
    ["not covered", "not covered"],
    ["prohibited", "fake slip"],
    ["liability", "limited to the amount you paid"],
    ["last updated", "Last updated"],
  ]) ok("มีหัวข้อ " + name, en.includes(kw), kw);
  ok("จำนวนการ์ดหัวข้อเท่ากันทั้งสองภาษา",
    block("th").querySelectorAll(".card").length === block("en").querySelectorAll(".card").length,
    block("th").querySelectorAll(".card").length + " vs " + block("en").querySelectorAll(".card").length);
}

section("ปุ่มติดต่อแอดมินดึงลิงก์จาก shop-config");
for (const id of ["policy-contact-th", "policy-contact-en"]) {
  const a = $(id);
  ok(id + " มีอยู่", !!a);
  ok(id + " ไม่ค้างที่ #", a && a.getAttribute("href") !== "#", a?.getAttribute("href"));
  ok(id + " ตรงกับช่องทางในไฟล์ตั้งค่า", a?.getAttribute("href") === fb.url);
  ok(id + " เปิดแท็บใหม่อย่างปลอดภัย (noopener)", (a?.getAttribute("rel") || "").includes("noopener"));
}

section("สลับภาษา");
window.toggleLang();
await tick(2);
ok("อังกฤษโผล่", block("en").hidden === false);
ok("ไทยซ่อน", block("th").hidden === true);
ok("ชื่อหน้าในหัวเว็บเปลี่ยนตามภาษา",
  document.querySelector("header .brand small").textContent.includes("Terms"),
  document.querySelector("header .brand small").textContent);
window.toggleLang();
await tick(2);
ok("กดกลับมาเป็นไทยได้", block("th").hidden === false && block("en").hidden === true);

section("ลิงก์ในกล่องติดต่อแอดมิน (contact.js)");
{
  const src = fs.readFileSync(path.join(SRC, "contact.js"), "utf8");
  ok("มีลิงก์ไปหน้าเงื่อนไข", src.includes('href="terms.html"'));
  ok("ยังมีลิงก์ไปหน้านโยบายความเป็นส่วนตัว", src.includes('href="privacy.html"'));
  const css = fs.readFileSync(path.join(SRC, "style.css"), "utf8").replace(/\s*\n\s*/g, " ");
  ok("ลิงก์ทั้งสองอันมีสไตล์รองรับ (.contact-policy a)", /\.contact-policy a\{/.test(css));
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
