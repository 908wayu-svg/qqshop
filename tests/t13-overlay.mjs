// ===== ทดสอบกล่องลอย: ปิดด้วย Esc / กดพื้นที่มืด / ล็อกการเลื่อนหน้าหลัง =====
import { buildSandbox, makeDom, loadI18n, runClassic, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";

buildSandbox(); makeDom("index.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const press = key => document.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
const clickOn = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

store.put("products/p1", { name: "ของทดสอบ", price: 100, stock: 5, active: true });
const app = runClassic("app.js");
document.dispatchEvent(new window.Event("DOMContentLoaded"));
await tick(8);

section("เปิด/ปิดตะกร้า");
app.openCart();
ok("ตะกร้าเปิด", $("cart-overlay").classList.contains("open"));
await tick(2);
ok("ล็อกไม่ให้หน้าหลังเลื่อน", document.body.style.overflow === "hidden", "ได้ " + document.body.style.overflow);

press("Escape");
ok("กด Esc แล้วปิด", !$("cart-overlay").classList.contains("open"));
ok("ปลดล็อกการเลื่อนแล้ว", document.body.style.overflow === "");

app.openCart();
await tick(2);
clickOn($("cart-overlay"));
ok("กดพื้นที่มืดแล้วปิด", !$("cart-overlay").classList.contains("open"));

section("กดในกล่องต้องไม่ปิด");
app.openCart();
await tick(2);
clickOn($("cart-overlay").querySelector(".panel"));
ok("กดในกล่องแล้วยังเปิดอยู่", $("cart-overlay").classList.contains("open"));
clickOn($("cart-overlay").querySelector("h2"));
ok("กดตัวหนังสือในกล่องแล้วยังเปิดอยู่", $("cart-overlay").classList.contains("open"));

section("ปุ่มกากบาทเดิมยังใช้ได้");
// jsdom ไม่รัน onclick ที่เขียนใน HTML จึงเรียกฟังก์ชันเดียวกับที่ปุ่มเรียกโดยตรง
ok("ปุ่มกากบาทเรียก closePanel ของหน้านั้น",
  $("cart-overlay").querySelector(".btn-close").getAttribute("onclick") === "closePanel('cart-overlay')");
window.closePanel("cart-overlay");
await tick(3);
ok("ปิดด้วยปุ่มกากบาทได้", !$("cart-overlay").classList.contains("open"));
ok("ปลดล็อกการเลื่อนแล้ว", document.body.style.overflow === "");

section("กด Esc ตอนไม่มีกล่องเปิด");
let threw = false;
try { press("Escape"); press("Enter"); } catch { threw = true; }
ok("ไม่พังและไม่ทำอะไร", !threw && document.body.style.overflow === "");

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
