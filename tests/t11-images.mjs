// ===== ทดสอบรูปสินค้าแบบแยกเอกสาร + โหลดตอนเลื่อนถึง =====
import { buildSandbox, makeDom, loadI18n, runClassic, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";

buildSandbox(); makeDom("index.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const bytes = o => Buffer.byteLength(JSON.stringify(o, (k, v) => v?.ms ? v.ms : v));
const IMG = "data:image/jpeg;base64," + "A".repeat(150000) + "==";
const IMG2 = "data:image/png;base64," + "B".repeat(100) + "==";

await QQ.registerWithEmail("908wayu@gmail.com", "adminpass", "เจ้าของร้าน", "");
await tick(6);

section("แอดมินบันทึกสินค้าพร้อมรูป");
const ref = await QQ.saveProduct(null, { name: "สินค้ามีรูป", price: 100, active: true, image: IMG });
const prod = store.raw("products/" + ref.id);
ok("เอกสารสินค้าไม่มีรูปฝังอยู่", !("image" in prod));
ok("มีธงบอกว่ามีรูป", prod.hasImage === true);
ok("รูปถูกเก็บแยกเอกสาร", store.raw("productImages/" + ref.id)?.image === IMG);
ok("ดึงรูปกลับมาได้", (await QQ.fetchProductImage(ref.id)) === IMG);

section("แก้ไขโดยไม่แตะรูป = ไม่เขียนรูปทับ");
await QQ.saveProduct(ref.id, { name: "เปลี่ยนชื่อ", price: 120, active: true });
ok("ชื่อเปลี่ยน", store.raw("products/" + ref.id).name === "เปลี่ยนชื่อ");
ok("รูปเดิมยังอยู่ครบ", store.raw("productImages/" + ref.id)?.image === IMG);
ok("ธงมีรูปไม่ถูกล้าง", store.raw("products/" + ref.id).hasImage === true);

section("เปลี่ยนรูป / ลบรูป");
await QQ.saveProduct(ref.id, { name: "เปลี่ยนชื่อ", price: 120, active: true, image: IMG2 });
ok("รูปถูกเปลี่ยน", store.raw("productImages/" + ref.id)?.image === IMG2);
await QQ.saveProduct(ref.id, { name: "เปลี่ยนชื่อ", price: 120, active: true, image: null });
ok("ลบรูปแล้วเอกสารรูปหายไป", !store.raw("productImages/" + ref.id));
ok("ธงมีรูปถูกปิด", store.raw("products/" + ref.id).hasImage === false);

section("ลบสินค้า = ลบรูปตาม ไม่ทิ้งขยะ");
const ref2 = await QQ.saveProduct(null, { name: "จะโดนลบ", price: 10, active: true, image: IMG2 });
await QQ.deleteProduct(ref2.id);
ok("เอกสารสินค้าหาย", !store.raw("products/" + ref2.id));
ok("เอกสารรูปหายด้วย", !store.raw("productImages/" + ref2.id));

section("สินค้าแบบเก่าที่ยังฝังรูปไว้ ต้องใช้ได้ต่อ");
store.put("products/legacy", { name: "สินค้าเก่า", price: 50, active: true, image: IMG2 });
store.put("products/lazy1", { name: "สินค้าใหม่ 1", price: 60, active: true, hasImage: true });
store.put("productImages/lazy1", { image: IMG2 });
store.put("products/noimg", { name: "ไม่มีรูป", price: 70, active: true, emoji: "🎮" });

const app = runClassic("app.js");
document.dispatchEvent(new window.Event("DOMContentLoaded"));
await tick(8);

const grid = $("grid");
ok("สินค้าเก่าแสดงรูปฝังทันที", grid.innerHTML.includes(IMG2.slice(0, 40)));
ok("สินค้าใหม่ใส่ที่ว่างไว้ก่อน", grid.querySelector('img[data-pimg="lazy1"]') !== null);
ok("สินค้าไม่มีรูปใช้อีโมจิ", grid.innerHTML.includes("🎮"));

section("ขนาดข้อมูลที่หน้าร้านต้องโหลดตอนเปิดเว็บ");
store.state.docs.delete("products/legacy");
for (let i = 0; i < 60; i++) {
  store.put("products/big" + i, { name: "สินค้า " + i, price: 100, active: true, hasImage: true });
  store.put("productImages/big" + i, { image: IMG });
}
const list = await QQ.fetchProducts();
const listBytes = bytes(list);
const oldWay = 60 * IMG.length;
console.log("   รายการสินค้า 60 ชิ้น = " + (listBytes / 1024).toFixed(0) + " KB");
console.log("   ถ้ายังฝังรูปในเอกสารเหมือนเดิม = " + (oldWay / 1048576).toFixed(1) + " MB");
ok("รายการสินค้าเบากว่า 200 KB", listBytes < 204800, (listBytes / 1024).toFixed(0) + " KB");
ok("เบาลงอย่างน้อย 50 เท่า", oldWay / listBytes > 50, (oldWay / listBytes).toFixed(0) + " เท่า");

section("โหลดรูปตอนเลื่อนมาถึง");
// จำลอง IntersectionObserver แบบคุมเองได้ (jsdom ไม่มีให้)
let observed = [];
let fireVisible = null;
globalThis.IntersectionObserver = window.IntersectionObserver = function (cb) {
  this.observe = el => { observed.push(el); };
  this.unobserve = () => {};
  this.disconnect = () => {};
  fireVisible = els => cb(els.map(target => ({ isIntersecting: true, target })), this);
};
await app.loadProducts();
await tick(6);
ok("มีที่ว่างรอรูปครบทุกใบ", observed.length > 60, "รอ " + observed.length + " ใบ");
ok("ยังไม่โหลดรูปสักใบจนกว่าจะเลื่อนถึง", !grid.innerHTML.includes("A".repeat(500)));
fireVisible(observed.slice(0, 3));
await tick(10);
const filled = [...grid.querySelectorAll("img[data-pimg]")].filter(i => i.src === IMG || i.src === IMG2);
ok("เลื่อนถึงแล้วรูปถูกเติมให้", filled.length === 3, "เติมได้ " + filled.length + " ใบ");
ok("ใบที่ยังไม่เลื่อนถึงยังไม่โหลด", filled.length < observed.length);
delete globalThis.IntersectionObserver; delete window.IntersectionObserver;

section("โหลดรูปซ้ำใช้ของที่จำไว้ ไม่ยิงซ้ำ");
const before = store.state.reads;
await window.loadProductImage("lazy1");
await window.loadProductImage("lazy1");
ok("ไม่อ่านฐานข้อมูลซ้ำ", store.state.reads === before, "อ่านเพิ่ม " + (store.state.reads - before));

section("รูปที่โหลดไม่ได้ ไม่ทำให้หน้าพัง");
store.put("products/broken", { name: "รูปหาย", price: 10, active: true, hasImage: true });
await app.loadProducts();
window.watchProductImages(grid);
await tick(8);
const brokenImg = grid.querySelector('img[data-pimg="broken"]');
ok("แสดงเป็นรูปจางแทนที่จะพัง", brokenImg?.classList.contains("img-missing") === true);
ok("หน้าร้านยังแสดงสินค้าอื่นครบ", grid.querySelectorAll(".product").length > 60);

section("รูปปลอมถูกปฏิเสธ");
store.put("productImages/broken", { image: "javascript:alert(1)" });
window.PRODUCT_IMG_CACHE?.clear?.();
const bad = await QQ.fetchProductImage("broken");
ok("ฐานข้อมูลคืนค่ามาได้ แต่ตัวกรองต้องปัดทิ้ง", window.isSafeImage(bad) === null);

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
