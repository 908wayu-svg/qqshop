// ===== ทดสอบช่องกรอกไอดีเกมของลูกค้า (ของเติมเกม) =====
// แอดมินติ๊กที่สินค้าว่าต้องขออะไร → ลูกค้าต้องกรอกให้ครบก่อนถึงจะกดสั่งซื้อได้
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
const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

// ---------- Worker จำลอง (เก็บสิ่งที่หน้าเว็บส่งมาไว้ตรวจ) ----------
let SENT = null;
globalThis.fetch = async (url, opt) => {
  SENT = JSON.parse(opt.body);
  const oid = "ord" + Math.random().toString(36).slice(2, 10);
  const items = SENT.items.map(i => ({ ...i, name: store.raw("products/" + i.id).name,
    price: store.raw("products/" + i.id).price }));
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  store.put("orders/" + oid, { uid: QQ.user.uid, items, total, status: "pending",
    createdAt: new fs2.Timestamp(Date.now()) });
  return { ok: true, json: async () => ({ ok: true, orderId: oid, total, items }) };
};

store.put("products/pPlain", { name: "ไอดีเกมธรรมดา", price: 100, stock: 9, active: true, category: "game_id" });
store.put("products/pUid", { name: "เพชร 100 เม็ด", price: 50, stock: 99, active: true,
  category: "topup", askUid: true });
store.put("products/pLogin", { name: "เติมเข้าไอดีลูกค้า", price: 80, stock: 99, active: true,
  category: "topup", askLogin: true });

const app = runClassic("app.js");
document.dispatchEvent(new window.Event("DOMContentLoaded"));
await tick(8);

await QQ.registerWithEmail("buyer@test.com", "secret123", "ผู้ซื้อ", "0800000000");
await tick(6);
store.state.docs.set("users/" + QQ.user.uid, { ...store.raw("users/" + QQ.user.uid), credit: 5000 });
fs2.notifyAll(); await tick(4);

const field = (id, key) => document.querySelector(`[data-info-id="${id}"][data-info-key="${key}"]`);
const typeIn = (el, v) => { el.value = v; el.dispatchEvent(new window.Event("input", { bubbles: true })); };

section("สินค้าธรรมดา ไม่ต้องกรอกอะไรเพิ่ม");
app.addToCart("pPlain");
app.openCart();
await tick(3);
ok("ไม่มีช่องกรอกโผล่มา", document.querySelectorAll("[data-info-id]").length === 0);
ok("กดสั่งซื้อได้เลย", $("cart-checkout").disabled === false);

section("ของที่ขอ UID");
app.changeQty("pPlain", -1);
app.addToCart("pUid");
app.openCart();
await tick(3);
ok("มีช่องไอดีเกม/UID", !!field("pUid", "gameUid"));
ok("ไม่มีช่องรหัสผ่าน (ไม่ได้ติ๊กไว้)", !field("pUid", "gamePassword"));
ok("ยังกดสั่งซื้อไม่ได้ตอนยังไม่กรอก", $("cart-checkout").disabled === true);
ok("ขึ้นข้อความบอกให้กรอก", $("cart-msg").textContent.includes("ไอดีเกม"), $("cart-msg").textContent);

typeIn(field("pUid", "gameUid"), "  99887766  ");
await tick(2);
ok("กรอกแล้วกดสั่งซื้อได้", $("cart-checkout").disabled === false);

section("ของที่ขอชื่อผู้ใช้ + รหัสผ่าน");
app.addToCart("pLogin");
app.openCart();
await tick(3);
ok("มีช่องชื่อผู้ใช้", !!field("pLogin", "gameLogin"));
ok("มีช่องรหัสผ่าน", !!field("pLogin", "gamePassword"));
ok("มีคำเตือนให้เปลี่ยนรหัสผ่านหลังเติมเสร็จ",
  $("cart-list").textContent.includes("เปลี่ยนรหัสผ่าน"));
ok("กรอกไม่ครบ กดสั่งซื้อไม่ได้", $("cart-checkout").disabled === true);

typeIn(field("pLogin", "gameLogin"), "player01");
await tick(2);
ok("กรอกแค่ชื่อผู้ใช้ ยังกดไม่ได้", $("cart-checkout").disabled === true);
typeIn(field("pLogin", "gamePassword"), "pw1234");
await tick(2);
ok("กรอกครบแล้วกดได้", $("cart-checkout").disabled === false);

section("ค่าที่กรอกต้องไม่หายตอนกดเพิ่ม/ลดจำนวน");
app.changeQty("pUid", 1);
await tick(3);
ok("ค่า UID ยังอยู่", field("pUid", "gameUid").value.trim() === "99887766", field("pUid", "gameUid").value);
ok("ค่ารหัสผ่านยังอยู่", field("pLogin", "gamePassword").value === "pw1234");
app.changeQty("pUid", -1);
await tick(3);

section("ส่งข้อมูลไปเซิร์ฟเวอร์ตอนสั่งซื้อ");
await app.doCheckout();
await tick(10);
const sentUid = SENT.items.find(i => i.id === "pUid");
const sentLogin = SENT.items.find(i => i.id === "pLogin");
const sentPlain = SENT.items.find(i => i.id === "pPlain");
ok("ส่ง UID ไปด้วย (ตัดช่องว่างแล้ว)", sentUid.gameUid === "99887766", JSON.stringify(sentUid));
ok("ส่งชื่อผู้ใช้ + รหัสผ่านไปด้วย",
  sentLogin.gameLogin === "player01" && sentLogin.gamePassword === "pw1234", JSON.stringify(sentLogin));
ok("สินค้าที่ไม่ได้ขอ ไม่มีข้อมูลติดไปด้วย", !sentPlain);

section("ล้างรหัสผ่านออกจากหน่วยความจำหลังสั่งซื้อเสร็จ");
app.addToCart("pLogin");
app.openCart();
await tick(3);
ok("ช่องรหัสผ่านว่างเปล่าอีกครั้ง", field("pLogin", "gamePassword").value === "",
  field("pLogin", "gamePassword").value);

section("แอดมินลบรหัสผ่านลูกค้าออกจากออเดอร์ได้");
const oid = [...store.state.docs.keys()].find(k => k.startsWith("orders/")).split("/")[1];
store.state.docs.set("users/" + QQ.user.uid, { ...store.raw("users/" + QQ.user.uid), role: "admin" });
fs2.notifyAll(); await tick(4);
await QQ.clearOrderCustomerInfo(oid);
const after = store.raw("orders/" + oid).items;
ok("รหัสผ่านถูกลบออก", after.every(i => !i.gamePassword));
ok("ชื่อผู้ใช้ถูกลบออก", after.every(i => !i.gameLogin));
ok("ไอดีเกม/UID ยังอยู่เป็นหลักฐาน", after.some(i => i.gameUid === "99887766"));
ok("บันทึกเวลาที่ลบไว้", !!store.raw("orders/" + oid).customerInfoClearedAt);

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
