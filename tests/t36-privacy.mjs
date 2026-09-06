// ===== หน้านโยบายความเป็นส่วนตัว (privacy.html) =====
// เป็นเอกสารที่ผูกพันกับลูกค้าเหมือนหน้าเงื่อนไข แต่เดิมไม่มีเทสคุมเลย
// จุดที่พังง่ายแบบเดียวกับ terms.html:
//  - เขียนเพิ่มฝั่งไทยแล้วลืมฝั่งอังกฤษ → ลูกค้าคนละภาษาได้ข้อมูลไม่เท่ากัน
//  - อัปเดตวันที่แก้ไขล่าสุดฝั่งเดียว อีกฝั่งค้างปีเก่า
//  - สลับภาษาแล้วโชว์ทั้งสองภาษาพร้อมกัน หรือหายไปทั้งคู่
import { buildSandbox, makeDom, loadI18n, tick } from "./harness.mjs";

buildSandbox(); makeDom("privacy.html"); loadI18n();

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const block = lang => document.querySelector(`[data-lang-block="${lang}"]`);
const textOf = lang => block(lang).textContent.replace(/\s+/g, " ");

// สคริปต์สลับภาษาในหน้าเป็น module ฝังไว้ jsdom ไม่รันให้ จึงทำตรรกะเดียวกันเองที่นี่
function applyLangBlocks() {
  const lang = getLang();
  document.querySelectorAll("[data-lang-block]").forEach(el => { el.hidden = el.dataset.langBlock !== lang; });
}
applyLangBlocks();
document.addEventListener("langchange", applyLangBlocks);

section("โครงหน้า");
ok("มีบล็อกภาษาไทย", !!block("th"));
ok("มีบล็อกภาษาอังกฤษ", !!block("en"));
ok("เปิดหน้ามาเห็นภาษาไทย", block("th").hidden === false);
ok("ภาษาอังกฤษซ่อนอยู่ ไม่โชว์ซ้อนกัน", block("en").hidden === true);

section("เนื้อหาที่นโยบายความเป็นส่วนตัวต้องมี");
{
  const th = textOf("th");
  for (const [name, kw] of [
    ["เก็บข้อมูลอะไรบ้าง", "ข้อมูล"],
    ["อีเมล", "อีเมล"],
    ["สลิป", "สลิป"],
    ["ติดต่อร้าน", "ติดต่อ"],
    ["วันที่ปรับปรุงล่าสุด", "ปรับปรุงล่าสุด"],
  ]) ok("ฝั่งไทยมีเรื่อง " + name, th.includes(kw), kw);

  const en = textOf("en");
  for (const [name, kw] of [
    ["what we collect", "collect"],
    ["email", "email"],
    ["slip", "slip"],
    ["contact", "contact"],
    ["last updated", "Last updated"],
  ]) ok("ฝั่งอังกฤษมีเรื่อง " + name, en.toLowerCase().includes(kw.toLowerCase()), kw);
}

section("สองภาษาต้องพูดตรงกัน");
{
  const thCards = [...block("th").querySelectorAll(".card")];
  const enCards = [...block("en").querySelectorAll(".card")];
  ok("จำนวนหัวข้อเท่ากัน", thCards.length === enCards.length,
    thCards.length + " vs " + enCards.length);

  // นับแค่จำนวนหัวข้อไม่พอ ต้องดูข้อย่อยในแต่ละหัวข้อด้วย
  // ถ้าฝั่งไทยบอกว่าเก็บข้อมูลอะไรไว้ 6 อย่าง แต่ฝั่งอังกฤษบอก 5
  // = ลูกค้าที่อ่านภาษาอังกฤษไม่รู้ว่าร้านเก็บอะไรไว้อีกอย่าง
  const mismatch = [];
  thCards.forEach((c, i) => {
    const nTh = c.querySelectorAll("li").length;
    const nEn = enCards[i]?.querySelectorAll("li").length ?? -1;
    if (nTh !== nEn) {
      mismatch.push((c.querySelector("h2, h3")?.textContent || ("การ์ดที่ " + (i + 1))).trim()
        + " (ไทย " + nTh + " / อังกฤษ " + nEn + ")");
    }
  });
  ok("ข้อย่อยในแต่ละหัวข้อเท่ากันทั้งสองภาษา", mismatch.length === 0, mismatch.join(" · "));

  // ปีที่แก้ไขล่าสุด: ฝั่งไทยใช้ พ.ศ. ฝั่งอังกฤษใช้ ค.ศ. ต่างกัน 543 พอดี
  // ถ้าอัปเดตฝั่งเดียว จะเห็นได้ทันทีจากตรงนี้
  const nums = t => [...t.matchAll(/\d{4}/g)].map(m => Number(m[0]));
  const yTh = nums(textOf("th")).filter(n => n > 2400 && n < 2700);
  const yEn = nums(textOf("en")).filter(n => n > 1900 && n < 2200);
  ok("มีปีที่แก้ไขล่าสุดทั้งสองภาษา", yTh.length > 0 && yEn.length > 0,
    "ไทย: " + yTh.join(",") + " · อังกฤษ: " + yEn.join(","));
  ok("ปีตรงกัน (พ.ศ. = ค.ศ. + 543)",
    yTh.every(a => yEn.some(b => a - b === 543)),
    "ไทย: " + yTh.join(",") + " · อังกฤษ: " + yEn.join(","));
}

section("สลับภาษา");
toggleLang();
document.dispatchEvent(new window.CustomEvent("langchange"));
await tick(4);
ok("สลับแล้วเห็นภาษาอังกฤษ", block("en").hidden === false);
ok("ภาษาไทยถูกซ่อน", block("th").hidden === true);
toggleLang();
document.dispatchEvent(new window.CustomEvent("langchange"));
await tick(4);
ok("สลับกลับมาเป็นไทยได้", block("th").hidden === false && block("en").hidden === true);

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
