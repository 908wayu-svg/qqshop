// ===== ทดสอบระบบติดต่อแอดมิน: ปุ่มลอย + กล่องช่องทางติดต่อ =====
import { buildSandbox, makeDom, loadI18n, tick, SRC } from "./harness.mjs";
import fs from "fs";
import path from "path";

buildSandbox(); makeDom("index.html"); loadI18n();

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const press = key => document.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
const clickOn = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

const { SHOP } = await import("./sandbox/shop-config.mjs");
await import("./sandbox/contact.mjs");
document.dispatchEvent(new window.Event("DOMContentLoaded"));
await tick(4);

section("ปุ่มลอยมุมจอ");
const fab = $("contact-fab");
ok("มีปุ่มติดต่อแอดมิน", !!fab);
ok("เป็นปุ่มชนิด button ไม่ใช่ปุ่ม submit", fab?.type === "button");
ok("ข้อความปุ่มถูกแปลเป็นไทย", fab?.textContent.includes("ติดต่อแอดมิน"), fab?.textContent);
ok("ปุ่มอยู่ใต้กล่องลอย ไม่ทับกัน (z-index 90 < .overlay 100)",
  /\.contact-fab\{[^}]*z-index:90/.test(fs.readFileSync(path.join(SRC, "style.css"), "utf8")));

section("ช่องทางติดต่อ");
const items = [...document.querySelectorAll(".contact-item")];
const live = SHOP.contact.channels.filter(c => c.enabled !== false);
ok("จำนวนช่องทางตรงกับที่เปิดใช้ใน shop-config", items.length === live.length,
  items.length + " / " + live.length);
const fb = document.querySelector(".contact-facebook");
ok("มีช่องทาง Facebook", !!fb);
ok("ลิงก์เฟซบุ๊กถูกต้อง",
  fb?.getAttribute("href") === "https://www.facebook.com/yu.yuu.622674?locale=th_TH",
  fb?.getAttribute("href"));
ok("ทุกลิงก์เป็น http/https เท่านั้น", items.every(a => /^https?:\/\//.test(a.getAttribute("href"))));
ok("เปิดแท็บใหม่ทุกลิงก์", items.every(a => a.target === "_blank"));
ok("มี rel noopener กันหน้าเดิมโดนแย่งคุม", items.every(a => (a.rel || "").includes("noopener")));
ok("โชว์ชื่อช่องทาง", fb?.querySelector(".contact-meta b")?.textContent === "Facebook");
ok("โชว์ชื่อแอดมิน", fb?.querySelector(".contact-meta small")?.textContent === "วายุ");

section("เปิด/ปิดกล่อง");
const overlay = $("contact-overlay");
ok("กล่องยังไม่เปิดตอนเข้าหน้า", !overlay.classList.contains("open"));
clickOn(fab);
ok("กดปุ่มแล้วกล่องเปิด", overlay.classList.contains("open"));
await tick(2);
ok("ล็อกไม่ให้หน้าหลังเลื่อน", document.body.style.overflow === "hidden", document.body.style.overflow);
press("Escape");
ok("กด Esc แล้วปิด", !overlay.classList.contains("open"));
await tick(2);
ok("ปลดล็อกการเลื่อนแล้ว", document.body.style.overflow === "");

clickOn(fab);
await tick(2);
clickOn(overlay);
ok("กดพื้นที่มืดแล้วปิด", !overlay.classList.contains("open"));

clickOn(fab);
await tick(2);
clickOn(overlay.querySelector(".panel"));
ok("กดในกล่องแล้วยังเปิดอยู่", overlay.classList.contains("open"));
clickOn(overlay.querySelector("#contact-close"));
ok("ปุ่มกากบาทปิดได้", !overlay.classList.contains("open"));

section("สองภาษา");
ok("เวลาทำการเป็นไทย", $("contact-hours").textContent === SHOP.contact.hours,
  $("contact-hours").textContent);
window.toggleLang();
await tick(2);
ok("สลับเป็นอังกฤษแล้วปุ่มเปลี่ยนข้อความ", fab.textContent.includes("Contact admin"), fab.textContent);
ok("หัวข้อกล่องเป็นอังกฤษ",
  overlay.querySelector("#contact-title").textContent === "Contact the admin");
ok("เวลาทำการเปลี่ยนเป็นอังกฤษ", $("contact-hours").textContent === SHOP.contact.hoursEn,
  $("contact-hours").textContent);
ok("ชื่อช่องทางไม่ถูกแปลทับ", fb.querySelector(".contact-meta b").textContent === "Facebook");
window.toggleLang();
await tick(2);
ok("สลับกลับเป็นไทยได้", fab.textContent.includes("ติดต่อแอดมิน"));

section("หน้าต่างสั่งซื้อกับกล่องติดต่อไม่ตีกัน");
$("buy-overlay").classList.add("open");
await tick(2);
clickOn(fab);
ok("เปิดกล่องติดต่อทับตะกร้าได้", overlay.classList.contains("open"));
press("Escape");
ok("Esc ปิดกล่องบนสุด (ติดต่อ) ก่อน", !overlay.classList.contains("open"));
ok("หน้าต่างสั่งซื้อยังเปิดอยู่", $("buy-overlay").classList.contains("open"));
press("Escape");
ok("Esc อีกครั้งปิดหน้าต่างสั่งซื้อ", !$("buy-overlay").classList.contains("open"));
await tick(2);
ok("ปลดล็อกการเลื่อนแล้ว", document.body.style.overflow === "");

section("ทุกหน้าลูกค้าต้องมีปุ่มติดต่อ");
for (const page of ["index.html", "wallet.html", "purchases.html", "login.html"]) {
  const html = fs.readFileSync(path.join(SRC, page), "utf8");
  ok(page + " โหลด contact.js", html.includes('src="contact.js"'));
  ok(page + " โหลด ui.js (ต้องมี ไม่งั้นปิดกล่องด้วย Esc ไม่ได้)", html.includes('src="ui.js"'));
}
ok("หน้าหลังบ้านไม่ต้องมีปุ่มติดต่อตัวเอง",
  !fs.readFileSync(path.join(SRC, "admin.html"), "utf8").includes("contact.js"));

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
