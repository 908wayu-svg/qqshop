// ===== ตรวจความครบถ้วนของคำแปล =====
// ความผิดพลาดกลุ่มนี้ไม่ทำให้เว็บพัง แต่ผู้ใช้จะเห็นข้อความดิบ/ภาษาผิดโดยไม่มีใครรู้
//  - คีย์ไทยกับอังกฤษต้องมีครบเท่ากัน
//  - ห้ามมีคีย์ซ้ำในไฟล์ (JS จะเงียบๆ ใช้ตัวท้ายสุด ทับของเดิมที่เขียนไว้ก่อน)
//  - ทุก data-i18n ในไฟล์ HTML ต้องมีคำแปลจริง ไม่งั้นหน้าเว็บจะโชว์ชื่อคีย์
import fs from "fs";
import path from "path";
import { SRC } from "./harness.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");

const src = fs.readFileSync(path.join(SRC, "i18n.js"), "utf8");

// รัน i18n.js โดยยัด document/localStorage ปลอมให้ (ไฟล์นี้ผูกกับ DOM ตอนโหลด)
globalThis.document = {
  addEventListener() {}, dispatchEvent: () => true,
  querySelectorAll: () => [], documentElement: { lang: "th" },
};
globalThis.localStorage = { getItem: () => null, setItem() {} };
const I18N = new Function(src + "\n;return I18N;")();

section("คีย์ไทย/อังกฤษต้องตรงกัน");
const th = Object.keys(I18N.th), en = Object.keys(I18N.en);
const missingEn = th.filter(k => !(k in I18N.en));
const missingTh = en.filter(k => !(k in I18N.th));
ok("จำนวนคีย์เท่ากัน (" + th.length + ")", th.length === en.length, th.length + " vs " + en.length);
ok("ไม่มีคีย์ที่ขาดคำแปลอังกฤษ", missingEn.length === 0, missingEn.join(", "));
ok("ไม่มีคีย์ที่มีแต่อังกฤษ", missingTh.length === 0, missingTh.join(", "));

const emptyTh = th.filter(k => typeof I18N.th[k] === "string" && !I18N.th[k].trim());
const emptyEn = en.filter(k => typeof I18N.en[k] === "string" && !I18N.en[k].trim());
ok("ไม่มีคำแปลว่างเปล่า", emptyTh.length === 0 && emptyEn.length === 0,
  [...emptyTh, ...emptyEn].join(", "));

// ฝั่งอังกฤษต้องไม่หลงเหลือข้อความไทย (ยกเว้นสัญลักษณ์เงินบาท ที่ใช้ตัวเดียวกันทั้งสองภาษา)
const stillThai = en.filter(k =>
  typeof I18N.en[k] === "string" && /[ก-๙]/.test(I18N.en[k].replace(/฿/g, "")));
ok("ฝั่งอังกฤษไม่มีข้อความไทยหลงเหลือ", stillThai.length === 0, stillThai.join(", "));

section("ห้ามมีคีย์ซ้ำในไฟล์เดียวกัน");
// ตัดไฟล์เป็นช่วงของแต่ละภาษา แล้วนับชื่อคีย์ที่ตามด้วยค่าเป็นสตริง
function dupKeysIn(block) {
  const seen = new Map();
  for (const m of block.matchAll(/(?:^|[,{])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"/g)) {
    seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}
const thStart = src.indexOf("th: {");
const enStart = src.indexOf("en: {");
ok("หาโครงสร้างสองภาษาในไฟล์เจอ", thStart > -1 && enStart > thStart);
const dupTh = dupKeysIn(src.slice(thStart, enStart));
const dupEn = dupKeysIn(src.slice(enStart));
ok("ไม่มีคีย์ซ้ำในฝั่งไทย", dupTh.length === 0, dupTh.join(", "));
ok("ไม่มีคีย์ซ้ำในฝั่งอังกฤษ", dupEn.length === 0, dupEn.join(", "));

section("ทุก data-i18n ในหน้าเว็บต้องมีคำแปลจริง");
const pages = fs.readdirSync(SRC).filter(f => f.endsWith(".html") && f !== "google7927e7e3fa345a6c.html");
let missingUsed = [];
for (const page of pages) {
  const html = fs.readFileSync(path.join(SRC, page), "utf8");
  for (const attr of ["data-i18n", "data-i18n-placeholder", "data-i18n-title"]) {
    for (const m of html.matchAll(new RegExp(attr + '="([^"]+)"', "g"))) {
      if (!(m[1] in I18N.th)) missingUsed.push(page + " → " + m[1]);
    }
  }
}
ok("ตรวจครบทุกหน้า (" + pages.length + " หน้า)", pages.length >= 6, String(pages.length));
ok("ไม่มี data-i18n ที่ไม่มีคำแปล", missingUsed.length === 0, missingUsed.slice(0, 5).join(" · "));

section("เบราว์เซอร์ที่ปิดการเก็บข้อมูลเว็บ (โหมดส่วนตัว/บล็อกคุกกี้)");
{
  // เครื่องเหล่านี้จะ "โยนข้อผิดพลาด" ตอนแตะ localStorage ไม่ใช่แค่คืนค่าว่าง
  // i18n.js ถูกเรียกจากทุกข้อความในเว็บ ถ้าไม่ดักไว้ = เปิดเว็บไม่ขึ้นเลยทั้งเว็บ
  const boom = () => { throw new Error("SecurityError: storage is disabled"); };
  globalThis.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
  const api = new Function(src + "\n;return { t, money, getLang, setLang, toggleLang, applyLang };")();

  let crashed = null;
  try { api.applyLang(); } catch (e) { crashed = e.message; }
  ok("เปิดหน้าเว็บได้โดยไม่ล่ม", crashed === null, String(crashed));
  ok("อ่านภาษาได้ (ถอยไปใช้ไทยเป็นค่าเริ่มต้น)", api.getLang() === "th", api.getLang());
  ok("แปลข้อความได้ตามปกติ", api.t("cart") === I18N.th.cart, api.t("cart"));
  ok("จัดรูปแบบเงินได้ตามปกติ", api.money(100).includes("100"), api.money(100));

  let crashed2 = null;
  try { api.setLang("en"); } catch (e) { crashed2 = e.message; }
  ok("สลับภาษาได้ไม่ล่ม แม้บันทึกลงเครื่องไม่ได้", crashed2 === null, String(crashed2));
  ok("สลับแล้วภาษาเปลี่ยนจริงในหน้านี้", api.getLang() === "en", api.getLang());
  ok("ข้อความเปลี่ยนตามภาษาที่สลับ", api.t("cart") === I18N.en.cart, api.t("cart"));
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
