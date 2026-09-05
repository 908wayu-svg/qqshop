// ===== ทดสอบหมวดหมู่สินค้าหน้าร้าน: แท็บกรอง + คลิกเปลี่ยนหมวด =====
import { buildSandbox, makeDom, loadI18n, runClassic, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";

buildSandbox(); makeDom("index.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

store.put("products/pGame", { name: "ไอดีเกม A", price: 300, stock: 5, active: true, category: "game_id" });
store.put("products/pTopup", { name: "เพชร 100 เม็ด", price: 50, stock: 99, active: true, category: "topup" });
store.put("products/pOther", { name: "ของทั่วไปยังไม่ระบุหมวด", price: 20, active: true });   // ไม่มี category
store.put("products/pOff", { name: "ปิดขาย", price: 10, active: false, category: "game_id" });

const app = runClassic("app.js");
document.dispatchEvent(new window.Event("DOMContentLoaded"));
await tick(8);

section("แท็บหมวดหมู่");
const tabs = () => [...document.querySelectorAll(".cat-tab")];
ok("มีแท็บครบ (ทั้งหมด + 2 หมวดจาก shop-config)", tabs().length === 3, "ได้ " + tabs().length);
ok("แท็บแรกคือทั้งหมด และ active อยู่ตอนเปิดหน้า", tabs()[0].dataset.cat === "all" && tabs()[0].classList.contains("active"));
ok("มีแท็บไอดีเกม", tabs().some(b => b.dataset.cat === "game_id"));
ok("มีแท็บเติมเกม", tabs().some(b => b.dataset.cat === "topup"));
ok("ข้อความแท็บแปลเป็นไทยถูกต้อง",
  tabs().find(b => b.dataset.cat === "game_id").textContent.includes("ไอดีเกม"));

section("กรองตอนเลือก 'ทั้งหมด' (ค่าเริ่มต้น)");
const gridNames = () => [...document.querySelectorAll("#grid .product h3")].map(h => h.textContent);
ok("โชว์ทุกสินค้าที่เปิดขาย รวมของที่ยังไม่ระบุหมวด", gridNames().length === 3, gridNames().join(","));
ok("ไม่โชว์สินค้าที่ปิดขาย", !gridNames().some(n => n.includes("ปิดขาย")));

section("กดแท็บ 'ไอดีเกม'");
click(tabs().find(b => b.dataset.cat === "game_id"));
await tick(2);
ok("เหลือเฉพาะสินค้าหมวดไอดีเกม", gridNames().length === 1 && gridNames()[0] === "ไอดีเกม A", gridNames().join(","));
ok("แท็บไอดีเกม active", document.querySelector('.cat-tab[data-cat="game_id"]').classList.contains("active"));
ok("แท็บทั้งหมดเลิก active", !document.querySelector('.cat-tab[data-cat="all"]').classList.contains("active"));

section("กดแท็บ 'เติมเกม'");
click(document.querySelector('.cat-tab[data-cat="topup"]'));
await tick(2);
ok("เหลือเฉพาะสินค้าหมวดเติมเกม", gridNames().length === 1 && gridNames()[0] === "เพชร 100 เม็ด", gridNames().join(","));

section("สินค้าที่ยังไม่ระบุหมวด ไม่โผล่ในหมวดเฉพาะ");
ok("ไม่อยู่ในหมวดไอดีเกม", !gridNames().includes("ของทั่วไปยังไม่ระบุหมวด"));

section("กลับไปกด 'ทั้งหมด'");
click(document.querySelector('.cat-tab[data-cat="all"]'));
await tick(2);
ok("โชว์ครบทุกหมวดอีกครั้ง", gridNames().length === 3, gridNames().join(","));

section("สลับภาษาไม่ทำให้หมวดที่เลือกไว้หาย");
click(document.querySelector('.cat-tab[data-cat="topup"]'));
await tick(2);
window.toggleLang();
await tick(2);
ok("แท็บเติมเกมเปลี่ยนเป็นอังกฤษ",
  document.querySelector('.cat-tab[data-cat="topup"]').textContent.includes("top-up"),
  document.querySelector('.cat-tab[data-cat="topup"]').textContent);
ok("ยังกรองหมวดเดิมอยู่ (ไม่รีเซ็ตกลับเป็นทั้งหมด)",
  document.querySelector('.cat-tab[data-cat="topup"]').classList.contains("active"));
ok("รายการสินค้ายังกรองถูกหมวดหลังสลับภาษา", gridNames().length === 1 && gridNames()[0] === "เพชร 100 เม็ด");
window.toggleLang();
await tick(2);

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
