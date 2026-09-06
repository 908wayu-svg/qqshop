// ===== ทดสอบหน้าร้าน + หน้าต่างสั่งซื้อทันที (รันโค้ดจริงบน DOM จำลอง) =====
// ระบบใหม่: ไม่มีตะกร้าแล้ว กด "สั่งซื้อ" ที่การ์ด → เปิดหน้าต่างของชิ้นนั้น → หักเครดิตทันที
import { buildSandbox, makeDom, loadI18n, runClassic, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";
import * as authSdk from "./fake/auth-sdk.mjs";
import { installAdminServer } from "./fake/admin-server.mjs";

buildSandbox();
const dom = makeDom("index.html");
loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;   // ในเบราว์เซอร์ auth.js ตั้ง window.QQ ให้เอง
globalThis.window.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const clickEl = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const typeIn = (el, v) => { el.value = v; el.dispatchEvent(new window.Event("input", { bubbles: true })); };
const tick2 = () => tick(6);

// เซิร์ฟเวอร์จำลอง (/order + /admin/*) ใช้ตรรกะเดียวกับ Worker จริง
installAdminServer();
// ยิงตรงเข้า handleOrder ไม่ได้ถ้าไม่มี user จำลอง — เทสนี้ล็อกอินจริงผ่าน auth ปลอม

store.put("products/pA", { name: "ไอดีเกม A", name_en: "Game ID A", price: 300, stock: 3, active: true, digital: true });
store.put("products/pB", { name: "ของหมด", price: 100, stock: 0, active: true });
store.put("products/pC", { name: "ปิดขาย", price: 50, stock: 9, active: false });
store.put("products/pD", { name: "สต๊อกไม่จำกัด", price: 20, active: true });
const stockFor = (pid, n) => {
  for (let i = 1; i <= n; i++) {
    store.put(`products/${pid}/stockItems/k${i}`,
      { login: "acc" + i, password: "pw" + i, note: "", status: "available", sort: i });
  }
};
stockFor("pA", 3);

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
ok("ปุ่มบนการ์ดเป็น 'สั่งซื้อ' ไม่ใช่ 'เพิ่มลงตะกร้า'",
  $("grid").innerHTML.includes("สั่งซื้อ") && !$("grid").innerHTML.includes("ตะกร้า"));
ok("ไม่มีปุ่มตะกร้าบนหัวเว็บแล้ว", !$("cart-btn") && !$("cart-overlay"));

section("เปิดหน้าต่างสั่งซื้อจากการ์ดสินค้า");
clickEl($("grid").querySelector('[data-buy="pA"]'));
await tick2();
ok("หน้าต่างเปิด", $("buy-overlay").classList.contains("open"));
ok("โชว์ชื่อสินค้า", $("buy-head").textContent.includes("ไอดีเกม A"));
ok("โชว์ราคาต่อชิ้น", $("buy-head").textContent.includes("300"));
ok("เริ่มที่จำนวน 1", $("buy-qty").value === "1");
ok("ยอดรวมตรงกับ 1 ชิ้น", $("buy-total").textContent.includes("300"));
ok("มีกล่องเงื่อนไขการเคลม", $("buy-terms-list").children.length === 3);
ok("เงื่อนไขบอกให้อัดวิดีโอ", $("buy-terms-list").textContent.includes("อัดวิดีโอ"));
ok("เงื่อนไขบอกเวลา 10 นาที", $("buy-terms-list").textContent.includes("10 นาที"));
ok("เงื่อนไขบอกว่าไม่มีวิดีโอเคลมไม่ได้", $("buy-terms-list").textContent.includes("ไม่มีวิดีโอ"));
ok("ยังไม่ติ๊กยอมรับ", $("buy-accept").checked === false);
ok("ปุ่มยืนยันยังกดไม่ได้ (ยังไม่ล็อกอิน = พาไปหน้าล็อกอิน)", $("buy-confirm").disabled === false);
ok("ขึ้นข้อความให้ล็อกอินก่อน", $("buy-msg").textContent.includes("เข้าสู่ระบบ"));

section("เลือกจำนวน");
clickEl($("buy-plus"));
ok("กดเพิ่มได้", $("buy-qty").value === "2");
ok("ยอดรวมเปลี่ยนตาม", $("buy-total").textContent.includes("600"));
clickEl($("buy-plus")); clickEl($("buy-plus")); clickEl($("buy-plus"));
ok("เพิ่มเกินสต๊อกไม่ได้ (มี 3 ชิ้น)", $("buy-qty").value === "3", $("buy-qty").value);
clickEl($("buy-minus")); clickEl($("buy-minus")); clickEl($("buy-minus")); clickEl($("buy-minus"));
ok("ลดต่ำกว่า 1 ไม่ได้", $("buy-qty").value === "1");
typeIn($("buy-qty"), "999");
ok("พิมพ์เลขเกินสต๊อกเองก็ถูกจำกัด", $("buy-total").textContent.includes("900"), $("buy-total").textContent);
typeIn($("buy-qty"), "");
ok("ลบเลขจนว่างแล้วไม่พัง", $("buy-total").textContent.includes("300"));
typeIn($("buy-qty"), "-5");
ok("ใส่เลขติดลบก็ยังเป็น 1", $("buy-total").textContent.includes("300"));
typeIn($("buy-qty"), "abc");
ok("ใส่ตัวอักษรก็ยังเป็น 1", $("buy-total").textContent.includes("300"));

section("ต้องติ๊กยอมรับเงื่อนไขก่อน");
await QQ.registerWithEmail("buyer@test.com", "secret123", "ผู้ซื้อ", "0800000000");
await tick(6);
store.state.docs.set("users/" + QQ.user.uid, { ...store.raw("users/" + QQ.user.uid), credit: 1000 });
fs2.notifyAll(); await tick(3);

app.openBuy("pA");
await tick2();
ok("แสดงเครดิตของฉัน", $("buy-credit").textContent.includes("1,000"), $("buy-credit").textContent);
ok("ยังกดยืนยันไม่ได้ตอนไม่ติ๊ก", $("buy-confirm").disabled === true);
ok("บอกว่าต้องติ๊กยอมรับก่อน", $("buy-msg").textContent.includes("ยอมรับ"), $("buy-msg").textContent);

$("buy-accept").checked = true;
$("buy-accept").dispatchEvent(new window.Event("change", { bubbles: true }));
ok("ติ๊กแล้วกดได้", $("buy-confirm").disabled === false);
ok("ไม่มีข้อความเตือนแล้ว", $("buy-msg").textContent === "");
ok("โชว์เครดิตคงเหลือหลังซื้อ", $("buy-after").textContent.includes("700"), $("buy-after").textContent);

section("ซื้อไอดีเกม — ได้ของทันที");
clickEl($("buy-confirm"));
await tick(10);
ok("ขึ้นหน้าจอซื้อสำเร็จ", !$("buy-done").classList.contains("hidden"));
ok("ซ่อนฟอร์มสั่งซื้อแล้ว", $("buy-form").classList.contains("hidden"));
ok("บอกว่าไปดูรหัสในประวัติการซื้อได้เลย", $("buy-done-msg").textContent.includes("ประวัติการซื้อ"));
ok("โชว์เลขที่คำสั่งซื้อ", $("buy-done-id").textContent.length >= 6, $("buy-done-id").textContent);
ok("บอกว่าเริ่มนับเวลาเคลมแล้ว", $("buy-done-claim").textContent.includes("10"),
  $("buy-done-claim").textContent);

const orderKey = [...store.state.docs.keys()].find(k => k.startsWith("orders/"));
const order = store.raw(orderKey);
ok("มีออเดอร์ในฐานข้อมูล", !!order);
ok("สถานะเป็น completed ทันที", order.status === "completed", order.status);
ok("ทำเครื่องหมายว่าหักเครดิตแล้ว", order.paid === true);
ok("หักเครดิตจริง (1000 - 300)", store.raw("users/" + QQ.user.uid).credit === 700,
  String(store.raw("users/" + QQ.user.uid).credit));
ok("ส่งมอบไอดีให้ลูกค้าแล้ว", order.items[0].delivered?.length === 1);
ok("มีรหัสผ่านจริงในของที่ส่ง", !!order.items[0].delivered[0].password);
ok("เริ่มจับเวลาเคลมทันที", !!order.claimTimerStartedAt);

section("เลือกซื้อต่อ");
clickEl($("buy-again"));
ok("ปิดหน้าต่างได้", !$("buy-overlay").classList.contains("open"));
await tick(6);
ok("สต๊อกหน้าร้านลดลงเอง", $("grid").innerHTML.includes("เหลือ 2"), $("grid").innerHTML.includes("เหลือ 3") ? "ยังเป็น 3" : "");

section("เครดิตไม่พอ");
store.state.docs.set("users/" + QQ.user.uid, { ...store.raw("users/" + QQ.user.uid), credit: 10 });
fs2.notifyAll(); await tick(3);
app.openBuy("pA");
await tick2();
$("buy-accept").checked = true;
$("buy-accept").dispatchEvent(new window.Event("change", { bubbles: true }));
ok("ปุ่มยืนยันถูกปิด", $("buy-confirm").disabled === true);
ok("ขึ้นข้อความเครดิตไม่พอ", $("buy-msg").textContent.includes("เครดิตไม่พอ"));
ok("ซ่อนบรรทัดเครดิตคงเหลือหลังซื้อ (ติดลบไม่มีความหมาย)",
  $("buy-after-row").classList.contains("hidden"));

// เครดิตเข้าระหว่างที่กล่องเปิดค้างอยู่ (เพิ่งเติมเงินอีกแท็บ / แอดมินเพิ่งปรับให้)
// กล่องต้องอัปเดตเอง ไม่ใช่ค้างที่ "เครดิตไม่พอ" จนลูกค้าคิดว่าเว็บพัง
store.state.docs.set("users/" + QQ.user.uid, { ...store.raw("users/" + QQ.user.uid), credit: 5000 });
fs2.notifyAll(); await tick(6);
ok("เครดิตเข้าระหว่างเปิดกล่อง แล้วกล่องอัปเดตเอง",
  $("buy-credit").textContent.includes("5,000"), $("buy-credit").textContent);
ok("ปุ่มยืนยันกลับมากดได้เอง ไม่ต้องปิดแล้วเปิดใหม่", $("buy-confirm").disabled === false);
ok("ข้อความเครดิตไม่พอหายไป", !$("buy-msg").textContent.includes("เครดิตไม่พอ"),
  $("buy-msg").textContent);
window.closePanel("buy-overlay");

section("เซิร์ฟเวอร์ปฏิเสธหลังกดยืนยัน (ของหมดพอดี)");
{
  store.state.docs.set("users/" + QQ.user.uid, { ...store.raw("users/" + QQ.user.uid), credit: 5000 });
  fs2.notifyAll(); await tick(3);
  await app.loadProducts();
  app.openBuy("pA");
  await tick2();
  $("buy-accept").checked = true;
  $("buy-accept").dispatchEvent(new window.Event("change", { bubbles: true }));

  // คนอื่นคว้าไอดีที่เหลือไปหมดระหว่างที่ลูกค้าเปิดหน้าค้างไว้
  for (const k of [...store.state.docs.keys()].filter(k => k.startsWith("products/pA/stockItems/"))) {
    store.put(k, { ...store.raw(k), status: "sold" });
  }
  globalThis.__alerts = [];
  const creditBefore = store.raw("users/" + QQ.user.uid).credit;
  await app.doBuy();
  await tick(8);
  ok("แปลข้อความผิดพลาดเป็นภาษาคน",
    globalThis.__alerts.some(a => a.includes("ไม่พอ")), JSON.stringify(globalThis.__alerts));
  ok("ไม่หักเครดิตเลยตอนสั่งไม่ผ่าน", store.raw("users/" + QQ.user.uid).credit === creditBefore,
    String(store.raw("users/" + QQ.user.uid).credit));
  ok("ไม่ขึ้นหน้าจอซื้อสำเร็จ", $("buy-done").classList.contains("hidden"));
  ok("ปุ่มยืนยันกลับมากดได้", $("buy-confirm").disabled === false);
}

section("สินค้าหมดระหว่างที่กล่องสั่งซื้อเปิดค้างอยู่");
// เกิดจริงเมื่อคนอื่นซื้อตัดหน้าไปพอดี แล้วหน้าร้านดึงสินค้ามาใหม่ (เกิดหลังกดยืนยันไม่ผ่าน)
// จำนวนต้องไม่ถูกบีบลงเป็น 0 ไม่งั้นยอดรวมกลายเป็น ฿0 คำเตือนหาย และปุ่มยืนยันกลับมากดได้
{
  store.put("products/pStock", { name: "ของชิ้นสุดท้าย", price: 250, stock: 1, active: true });
  await app.loadProducts();
  app.openBuy("pStock");
  await tick2();
  ok("เปิดกล่องได้ตอนยังมีของ", $("buy-qty").value === "1");

  // คนอื่นซื้อไปพอดี
  store.put("products/pStock", { ...store.raw("products/pStock"), stock: 0 });
  await app.loadProducts();
  await tick2();

  clickEl($("buy-plus"));
  ok("กดเพิ่มจำนวนแล้วไม่กลายเป็น 0", $("buy-qty").value === "1", $("buy-qty").value);
  clickEl($("buy-minus"));
  ok("กดลดจำนวนแล้วก็ยังไม่เป็น 0", $("buy-qty").value === "1", $("buy-qty").value);
  // ช่องพิมพ์จำนวนเป็นโค้ดคนละก้อนกับปุ่มเพิ่ม/ลด ต้องตรวจแยก
  // (เคยแก้แค่ปุ่ม แล้วช่องพิมพ์ยังผิดอยู่)
  typeIn($("buy-qty"), "5");
  ok("พิมพ์จำนวนเองก็ไม่กลายเป็น 0", $("buy-total").textContent.includes("250"),
    $("buy-total").textContent);
  ok("ยังเตือนว่าของไม่พอหลังพิมพ์เอง", $("buy-msg").textContent.includes("ไม่พอ"),
    $("buy-msg").textContent);
  ok("ปุ่มยืนยันยังกดไม่ได้หลังพิมพ์เอง", $("buy-confirm").disabled === true);
  ok("ยอดรวมไม่กลายเป็น ฿0", !/^฿?0(\.00)?$/.test($("buy-total").textContent.trim()),
    $("buy-total").textContent);
  ok("ยังเตือนว่าของไม่พอ", $("buy-msg").textContent.includes("ไม่พอ"), $("buy-msg").textContent);
  ok("ปุ่มยืนยันกดไม่ได้", $("buy-confirm").disabled === true);

  window.closePanel("buy-overlay");
  store.state.docs.delete("products/pStock");
  await app.loadProducts();
}

section("สั่งซื้อสินค้าสต๊อกไม่จำกัด (ของเติมเกม)");
{
  await app.loadProducts();
  app.openBuy("pD");
  await tick2();
  $("buy-accept").checked = true;
  $("buy-accept").dispatchEvent(new window.Event("change", { bubbles: true }));
  clickEl($("buy-plus"));         // 2 ชิ้น
  await app.doBuy();
  await tick(8);
  const k = [...store.state.docs.keys()].filter(x => x.startsWith("orders/"))
    .map(x => store.raw(x)).find(o => o.items[0].id === "pD");
  ok("สั่งได้", !!k, "ไม่เจอออเดอร์");
  ok("ของที่ไม่ใช่ไอดีเกมสถานะเป็น pending", k.status === "pending", k.status);
  ok("หักเครดิตแล้วเหมือนกัน", k.creditAfter === k.creditBefore - 40, JSON.stringify(k.creditBefore));
  ok("บอกว่าเวลาเคลมจะเริ่มนับตอนแอดมินทำเสร็จ",
    $("buy-done-claim").textContent.includes("แอดมิน"), $("buy-done-claim").textContent);
}

section("สลับภาษา");
await app.loadProducts();
window.toggleLang();
await tick(3);
ok("ชื่อสินค้าเปลี่ยนเป็นอังกฤษ", $("grid").innerHTML.includes("Game ID A"));
ok("ปุ่มเปลี่ยนเป็นอังกฤษ", $("grid").innerHTML.includes("Buy now"));
window.toggleLang();
await tick(3);
ok("กลับมาไทยได้", $("grid").innerHTML.includes("สั่งซื้อ"));

section("สลับภาษาตอนเปิดหน้าต่างสั่งซื้อค้างไว้");
{
  app.openBuy("pA");
  await tick2();
  $("buy-accept").checked = true;
  $("buy-accept").dispatchEvent(new window.Event("change", { bubbles: true }));
  clickEl($("buy-plus"));
  window.toggleLang();
  await tick(4);
  ok("เงื่อนไขเปลี่ยนเป็นอังกฤษ", $("buy-terms-list").textContent.includes("video"),
    $("buy-terms-list").textContent.slice(0, 40));
  ok("จำนวนที่เลือกไว้ไม่หาย", $("buy-qty").value === "2", $("buy-qty").value);
  ok("การติ๊กยอมรับไม่หาย", $("buy-accept").checked === true);
  ok("ปุ่มยืนยันยังกดได้", $("buy-confirm").disabled === false);
  window.toggleLang();
  await tick(3);
  app.closePanel("buy-overlay");
}

section("กัน XSS");
store.put("products/pX", { name: '<img src=x onerror="window.__pwned=1">', price: 10, active: true,
  image: 'javascript:alert(1)', emoji: "<script>window.__pwned=1</script>" });
await app.loadProducts();
ok("ชื่อสินค้าถูก escape", !$("grid").querySelector("img[src='x']"));
ok("รูปที่ไม่ใช่ data: ถูกปฏิเสธ", ![...$("grid").querySelectorAll("img")].some(i => i.src.startsWith("javascript")));
ok("ไม่มีสคริปต์ถูกฝัง", !$("grid").querySelector("script") && window.__pwned === undefined);

app.openBuy("pX");
await tick2();
ok("ชื่อสินค้าในหน้าต่างสั่งซื้อก็ถูก escape", !$("buy-head").querySelector("img[src='x']"));
ok("ไม่มีสคริปต์ถูกรันจากหน้าต่างสั่งซื้อ", window.__pwned === undefined);
app.closePanel("buy-overlay");

section("รหัสสินค้าแปลกปลอมต้องไม่หลุดเป็นโค้ด");
store.put("products/p'-alert(1)-'x", { name: "รหัสมีอัญประกาศ", price: 10, active: true });
await app.loadProducts();
ok("หน้าร้านยังวาดได้ปกติ", $("grid").querySelectorAll(".product").length >= 2);
const weird = [...$("grid").querySelectorAll("[data-buy]")].find(b => b.dataset.buy.includes("alert"));
ok("รหัสถูกเก็บใน data-buy ตามจริง ไม่หลุดเป็นโค้ด",
  !!weird && weird.getAttribute("data-buy") === "p'-alert(1)-'x",
  weird ? weird.getAttribute("data-buy") : "ไม่พบปุ่ม");
ok("ไม่มีสคริปต์ถูกรัน", window.__pwned === undefined);

section("เซสชันหมดอายุระหว่างเปิดหน้าค้างไว้");
{
  // ลูกค้าเปิดหน้าทิ้งไว้นาน แล้วกดสั่งซื้อ — ต้องบอกให้เข้าสู่ระบบใหม่
  // ไม่ใช่โยนข้อความภาษาโปรแกรมที่อ่านไม่รู้เรื่องใส่หน้าลูกค้า
  const realUser = authSdk.authObj.currentUser;
  authSdk.authObj.currentUser = null;
  let crashed = null;
  try { await QQ.createOrder([{ id: "pD", qty: 1 }]); }
  catch (e) { crashed = { msg: e.message, code: e.orderCode }; }
  authSdk.authObj.currentUser = realUser;

  ok("บอกรหัสสาเหตุว่าเซสชันหมดอายุ", crashed?.code === "UNAUTHORIZED", JSON.stringify(crashed));
  ok("ข้อความเป็นภาษาคน ไม่ใช่ข้อความภาษาโปรแกรม",
    typeof crashed?.msg === "string" && crashed.msg.includes("เข้าสู่ระบบ"), crashed?.msg);
}

section("ปุ่มในหน้าต่างสั่งซื้อต้องไม่ใช้ onclick ฝังในแอตทริบิวต์");
ok("การ์ดสินค้าไม่มี onclick", !$("grid").innerHTML.includes("onclick="));

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
