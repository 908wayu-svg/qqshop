// ===== ทดสอบหน้าร้าน + ตะกร้า (รันโค้ดจริงบน DOM จำลอง) =====
import { buildSandbox, makeDom, loadI18n, runClassic, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";

buildSandbox();
const dom = makeDom("index.html");
loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;   // ในเบราว์เซอร์ auth.js ตั้ง window.QQ ให้เอง

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);

// ---------- Worker จำลอง (ทำหน้าที่แทน service account) ----------
let ORDER_FORCE_ERROR = null;
globalThis.fetch = async (url, opt) => {
  const body = JSON.parse(opt.body);
  const J = o => ({ ok: true, json: async () => o });
  if (ORDER_FORCE_ERROR) { const e = ORDER_FORCE_ERROR; ORDER_FORCE_ERROR = null; return J({ ok: false, error: e }); }
  const want = new Map();
  for (const it of body.items) want.set(String(it.id), (want.get(String(it.id)) || 0) + Number(it.qty));
  let total = 0; const items = [];
  for (const [id, qty] of want) {
    const p = store.raw("products/" + id);
    if (!p) return J({ ok: false, error: "PRODUCT_NOT_FOUND" });
    if (p.active === false) return J({ ok: false, error: "PRODUCT_INACTIVE" });
    if (p.stock != null && p.stock < qty) return J({ ok: false, error: "OUT_OF_STOCK" });
    total += p.price * qty;
    items.push({ id, name: p.name, price: p.price, qty });
  }
  const me = store.raw("users/" + QQ.user.uid);
  if (Number(me.credit) < total) return J({ ok: false, error: "NOT_ENOUGH_CREDIT" });
  const oid = "ord" + Math.random().toString(36).slice(2, 10);
  store.put("orders/" + oid, { uid: QQ.user.uid, items, total, status: "pending", createdAt: new fs2.Timestamp(Date.now()) });
  return J({ ok: true, orderId: oid, total, items });
};

store.put("products/pA", { name: "ไอดีเกม A", name_en: "Game ID A", price: 300, stock: 3, active: true });
store.put("products/pB", { name: "ของหมด", price: 100, stock: 0, active: true });
store.put("products/pC", { name: "ปิดขาย", price: 50, stock: 9, active: false });
store.put("products/pD", { name: "สต๊อกไม่จำกัด", price: 20, active: true });

const app = runClassic("app.js");
document.dispatchEvent(new window.Event("DOMContentLoaded"));
await tick(8);

section("แสดงสินค้า");
const cards = document.querySelectorAll("#grid .product");
ok("แสดงเฉพาะสินค้าที่เปิดขาย", cards.length === 3, "ได้ " + cards.length);
ok("ไม่มีสินค้าที่ปิดขายโผล่", !$("grid").innerHTML.includes("ปิดขาย"));
ok("ของหมดขึ้นป้ายและกดไม่ได้", $("grid").innerHTML.includes("สินค้าหมด")
  && document.querySelector(".product.sold-out button").disabled === true);
ok("แสดงจำนวนคงเหลือ", $("grid").innerHTML.includes("เหลือ 3"));
ok("สต๊อกไม่จำกัดไม่โชว์ตัวเลข", !$("grid").innerHTML.match(/เหลือ undefined|เหลือ null/));

section("ตะกร้า");
localStorage.clear();
app.addToCart("pA"); app.addToCart("pA");
ok("เพิ่มลงตะกร้าได้", app.getCart().pA === 2);
ok("ตัวเลขบนไอคอนตะกร้าถูกต้อง", $("cart-count").textContent === "2");
app.addToCart("pA"); app.addToCart("pA");
ok("เพิ่มเกินสต๊อกไม่ได้", app.getCart().pA === 3, "ได้ " + app.getCart().pA);
app.addToCart("pC");
ok("เพิ่มสินค้าที่ปิดขายไม่ได้", app.getCart().pC === undefined);
app.addToCart("pB");
ok("เพิ่มของหมดไม่ได้", app.getCart().pB === undefined);
app.changeQty("pA", -1);
ok("ลดจำนวนได้", app.getCart().pA === 2);
app.changeQty("pA", -5);
ok("ลดจนหมดแล้วหายจากตะกร้า", app.getCart().pA === undefined);

section("ตะกร้าที่ถูกแก้จากภายนอก (localStorage)");
localStorage.setItem("qq_cart", "ข้อมูลพัง{{{");
ok("ข้อมูลพังไม่ทำให้ทั้งหน้าล่ม", Object.keys(app.getCart()).length === 0);
localStorage.setItem("qq_cart", JSON.stringify({ pA: -5, pB: "abc", pD: 2, pZ: 1 }));
const cleaned = app.getCart();
ok("จำนวนติดลบถูกตัดทิ้ง", cleaned.pA === undefined);
ok("จำนวนที่ไม่ใช่ตัวเลขถูกตัดทิ้ง", cleaned.pB === undefined);
ok("จำนวนที่ถูกต้องยังอยู่", cleaned.pD === 2);
app.pruneCart();
ok("สินค้าที่ไม่มีอยู่จริงถูกล้างออก", app.getCart().pZ === undefined);
localStorage.setItem("qq_cart", "null");
ok("ค่า null ไม่ทำให้พัง", Object.keys(app.getCart()).length === 0);

section("สินค้าถูกปิดขาย/ลบ ระหว่างที่ลูกค้าเปิดหน้าค้างไว้");
localStorage.clear();
app.addToCart("pA");
store.put("products/pA", { ...store.raw("products/pA"), active: false });
await app.loadProducts();
ok("ของที่ถูกปิดขายหลุดจากตะกร้าเอง", app.getCart().pA === undefined);
store.put("products/pA", { ...store.raw("products/pA"), active: true });
await app.loadProducts();
app.addToCart("pA"); app.addToCart("pA"); app.addToCart("pA");
store.put("products/pA", { ...store.raw("products/pA"), stock: 1 });
await app.loadProducts();
ok("จำนวนในตะกร้าถูกลดตามสต๊อกใหม่", app.getCart().pA === 1);

section("สั่งซื้อ (ยังไม่ล็อกอิน)");
localStorage.clear();
app.addToCart("pA");
app.openCart();
ok("ขึ้นข้อความให้ล็อกอินก่อน", $("cart-msg").textContent.includes("เข้าสู่ระบบ"));
ok("ปุ่มสั่งซื้อยังกดได้ (พาไปหน้าล็อกอิน)", $("cart-checkout").disabled === false);

section("สั่งซื้อ (ล็อกอินแล้ว)");
await QQ.registerWithEmail("buyer@test.com", "secret123", "ผู้ซื้อ", "0800000000");
await tick(6);
store.state.docs.set("users/" + QQ.user.uid, { ...store.raw("users/" + QQ.user.uid), credit: 1000 });
fs2.notifyAll(); await tick(3);
app.openCart();
ok("แสดงเครดิตของฉัน", $("cart-credit").textContent.includes("1,000"), $("cart-credit").textContent);
ok("ปุ่มสั่งซื้อเปิดใช้งาน", $("cart-checkout").disabled === false);
ok("ไม่มีข้อความเตือน", $("cart-msg").textContent === "");

await app.doCheckout();
await tick(6);
ok("สั่งซื้อสำเร็จ", globalThis.__alerts.some(a => a.includes("สั่งซื้อเรียบร้อย")), JSON.stringify(globalThis.__alerts));
ok("ตะกร้าถูกล้างหลังสั่งซื้อ", Object.keys(app.getCart()).length === 0);
ok("มีออเดอร์ในฐานข้อมูล", [...store.state.docs.keys()].some(k => k.startsWith("orders/")));

section("เครดิตไม่พอ");
globalThis.__alerts = [];
store.state.docs.set("users/" + QQ.user.uid, { ...store.raw("users/" + QQ.user.uid), credit: 10 });
fs2.notifyAll(); await tick(3);
store.put("products/pA", { ...store.raw("products/pA"), stock: 5 });
await app.loadProducts();
app.addToCart("pA");
app.openCart();
ok("ปุ่มสั่งซื้อถูกปิด", $("cart-checkout").disabled === true);
ok("ขึ้นข้อความเครดิตไม่พอ", $("cart-msg").textContent.includes("เครดิตไม่พอ"));

section("ราคาเปลี่ยนระหว่างเปิดตะกร้าค้างไว้");
globalThis.__alerts = [];
store.state.docs.set("users/" + QQ.user.uid, { ...store.raw("users/" + QQ.user.uid), credit: 100000 });
fs2.notifyAll(); await tick(3);
store.put("products/pA", { ...store.raw("products/pA"), price: 999 });
await app.doCheckout();
await tick(5);
ok("เตือนว่าราคาเปลี่ยน ไม่สั่งให้เลย", globalThis.__alerts.some(a => a.includes("เปลี่ยนแปลง")), JSON.stringify(globalThis.__alerts));
ok("ของยังอยู่ในตะกร้า", app.getCart().pA === 1);

section("เซิร์ฟเวอร์ตอบว่าของหมดหลังกดสั่ง");
globalThis.__alerts = [];
await app.loadProducts();
ORDER_FORCE_ERROR = "OUT_OF_STOCK";
await app.doCheckout();
await tick(5);
ok("แปลข้อความผิดพลาดเป็นภาษาคน", globalThis.__alerts.some(a => a.includes("มีไม่พอ")), JSON.stringify(globalThis.__alerts));
ok("ปุ่มสั่งซื้อกลับมากดได้", $("cart-checkout").disabled === false);

section("สลับภาษา");
window.toggleLang();
await tick(2);
ok("ชื่อสินค้าเปลี่ยนเป็นอังกฤษ", $("grid").innerHTML.includes("Game ID A"));
ok("ปุ่มเปลี่ยนเป็นอังกฤษ", $("grid").innerHTML.includes("Add to cart"));
window.toggleLang();
await tick(2);
ok("กลับมาไทยได้", $("grid").innerHTML.includes("เพิ่มลงตะกร้า"));

section("กัน XSS");
store.put("products/pX", { name: '<img src=x onerror="window.__pwned=1">', price: 10, active: true,
  image: 'javascript:alert(1)', emoji: "<script>window.__pwned=1</script>" });
await app.loadProducts();
ok("ชื่อสินค้าถูก escape", !$("grid").querySelector("img[src='x']"));
ok("รูปที่ไม่ใช่ data: ถูกปฏิเสธ", ![...$("grid").querySelectorAll("img")].some(i => i.src.startsWith("javascript")));
ok("ไม่มีสคริปต์ถูกฝัง", !$("grid").querySelector("script") && window.__pwned === undefined);

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;

section("ปุ่มเพิ่ม/ลดจำนวน ทำงานผ่านการคลิกจริง (ไม่ใช่ onclick ในแอตทริบิวต์)");
localStorage.clear();
store.put("products/pA", { ...store.raw("products/pA"), stock: 5, active: true, price: 300 });
await app.loadProducts();
const clickEl = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok("ไม่มี onclick ฝังในปุ่มสินค้าแล้ว", !$("grid").innerHTML.includes("onclick="));
clickEl($("grid").querySelector('[data-add="pA"]'));
ok("กดปุ่มเพิ่มลงตะกร้าได้จริง", app.getCart().pA === 1, JSON.stringify(app.getCart()));
app.openCart();
ok("ไม่มี onclick ฝังในปุ่มตะกร้าแล้ว", !$("cart-list").innerHTML.includes("onclick="));
clickEl($("cart-list").querySelector('[data-qty="1"]'));
ok("กดเพิ่มจำนวนได้", app.getCart().pA === 2, JSON.stringify(app.getCart()));
clickEl($("cart-list").querySelector('[data-qty="-1"]'));
ok("กดลดจำนวนได้", app.getCart().pA === 1, JSON.stringify(app.getCart()));
clickEl($("cart-list").querySelector('[data-qty="-1"]'));
ok("ลดจนหมดแล้วหายจากตะกร้า", app.getCart().pA === undefined);

section("รหัสสินค้าแปลกปลอมต้องไม่หลุดเป็นโค้ด");
store.put("products/p'-alert(1)-'x", { name: "รหัสมีอัญประกาศ", price: 10, active: true });
await app.loadProducts();
ok("หน้าร้านยังวาดได้ปกติ", $("grid").querySelectorAll(".product").length >= 2);
const weird = [...$("grid").querySelectorAll("[data-add]")].find(b => b.dataset.add.includes("alert"));
ok("รหัสถูกเก็บใน data-add ตามจริง ไม่หลุดเป็นโค้ด", !!weird && weird.getAttribute("data-add") === "p'-alert(1)-'x",
  weird ? weird.getAttribute("data-add") : "ไม่พบปุ่ม");
ok("ไม่มีสคริปต์ถูกรัน", window.__pwned === undefined);

console.log("\nสรุป(รวมท้าย): ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
