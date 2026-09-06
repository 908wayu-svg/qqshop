// ===== ทดสอบช่องกรอกไอดีเกมของลูกค้า (ของเติมเกม) =====
// แอดมินติ๊กที่สินค้าว่าต้องขออะไร → ลูกค้าต้องกรอกให้ครบก่อนถึงจะกดยืนยันสั่งซื้อได้
import { buildSandbox, makeDom, loadI18n, runClassic, tick, makeAdmin } from "./harness.mjs";
import { installAdminServer, calls } from "./fake/admin-server.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";

buildSandbox(); makeDom("index.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;
globalThis.window.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

// เซิร์ฟเวอร์จำลอง (/order + /admin/*) ใช้ตรรกะเดียวกับ Worker จริง
installAdminServer();

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

const field = key => document.querySelector(`#buy-fields [data-info-key="${key}"]`);
const typeIn = (el, v) => { el.value = v; el.dispatchEvent(new window.Event("input", { bubbles: true })); };
const accept = () => {
  $("buy-accept").checked = true;
  $("buy-accept").dispatchEvent(new window.Event("change", { bubbles: true }));
};
const lastSent = () => calls.filter(c => c.path === "/order").at(-1)?.body;

section("สินค้าธรรมดา ไม่ต้องกรอกอะไรเพิ่ม");
app.openBuy("pPlain");
await tick(3);
ok("ไม่มีช่องกรอกโผล่มา", document.querySelectorAll("#buy-fields [data-info-key]").length === 0);
accept();
ok("ติ๊กยอมรับแล้วกดยืนยันได้เลย", $("buy-confirm").disabled === false);
app.closePanel("buy-overlay");

section("ของที่ขอ UID");
app.openBuy("pUid");
await tick(3);
ok("มีช่องไอดีเกม/UID", !!field("gameUid"));
ok("ไม่มีช่องรหัสผ่าน (ไม่ได้ติ๊กไว้)", !field("gamePassword"));
accept();
ok("ยังกดยืนยันไม่ได้ตอนยังไม่กรอก", $("buy-confirm").disabled === true);
ok("ขึ้นข้อความบอกให้กรอก", $("buy-msg").textContent.includes("ไอดีเกม"), $("buy-msg").textContent);

typeIn(field("gameUid"), "  99887766  ");
await tick(2);
ok("กรอกแล้วกดยืนยันได้", $("buy-confirm").disabled === false);
ok("ช่องกรอกมีป้ายผูก (โปรแกรมอ่านหน้าจออ่านออก)",
  !!document.querySelector('#buy-fields label[for="bf-gameUid"]'));

section("ส่งข้อมูลไปเซิร์ฟเวอร์ตอนสั่งซื้อ (ของที่ขอ UID)");
click($("buy-confirm"));
await tick(10);
{
  const sent = lastSent().items[0];
  ok("ส่ง UID ไปด้วย (ตัดช่องว่างแล้ว)", sent.gameUid === "99887766", JSON.stringify(sent));
  ok("ไม่ส่งช่องที่สินค้านี้ไม่ได้ขอ", !sent.gameLogin && !sent.gamePassword);
  ok("ขึ้นหน้าจอซื้อสำเร็จ", !$("buy-done").classList.contains("hidden"));
  ok("บอกว่ารอแอดมินดำเนินการ", $("buy-done-msg").textContent.includes("แอดมิน"),
    $("buy-done-msg").textContent);
}
app.closePanel("buy-overlay");

section("ของที่ขอชื่อผู้ใช้ + รหัสผ่าน");
app.openBuy("pLogin");
await tick(3);
ok("มีช่องชื่อผู้ใช้", !!field("gameLogin"));
ok("มีช่องรหัสผ่าน", !!field("gamePassword"));
ok("มีคำเตือนให้เปลี่ยนรหัสผ่านหลังเติมเสร็จ",
  $("buy-fields").textContent.includes("เปลี่ยนรหัสผ่าน"));
accept();
ok("กรอกไม่ครบ กดยืนยันไม่ได้", $("buy-confirm").disabled === true);

typeIn(field("gameLogin"), "player01");
await tick(2);
ok("กรอกแค่ชื่อผู้ใช้ ยังกดไม่ได้", $("buy-confirm").disabled === true);
typeIn(field("gamePassword"), "pw1234");
await tick(2);
ok("กรอกครบแล้วกดได้", $("buy-confirm").disabled === false);

section("ค่าที่กรอกต้องไม่หายตอนกดเพิ่ม/ลดจำนวน");
click($("buy-plus"));
await tick(3);
ok("ค่าชื่อผู้ใช้ยังอยู่", field("gameLogin").value === "player01", field("gameLogin").value);
ok("ค่ารหัสผ่านยังอยู่", field("gamePassword").value === "pw1234");
ok("ยอดรวมคิดตามจำนวนใหม่", $("buy-total").textContent.includes("160"), $("buy-total").textContent);
click($("buy-minus"));
await tick(2);

section("ส่งข้อมูลไปเซิร์ฟเวอร์ตอนสั่งซื้อ (ของที่ขอชื่อผู้ใช้)");
click($("buy-confirm"));
await tick(10);
{
  const sent = lastSent().items[0];
  ok("ส่งชื่อผู้ใช้ + รหัสผ่านไปด้วย",
    sent.gameLogin === "player01" && sent.gamePassword === "pw1234", JSON.stringify(sent));
}

section("ล้างรหัสผ่านออกจากหน่วยความจำหลังสั่งซื้อเสร็จ");
app.openBuy("pLogin");
await tick(3);
ok("ช่องรหัสผ่านว่างเปล่าอีกครั้ง", field("gamePassword").value === "", field("gamePassword").value);
ok("ช่องชื่อผู้ใช้ว่างเปล่าด้วย", field("gameLogin").value === "");
app.closePanel("buy-overlay");

section("ข้อมูลลูกค้าไปถึงออเดอร์จริงในฐานข้อมูล");
const orderId = [...store.state.docs.keys()]
  .filter(k => k.startsWith("orders/"))
  .find(k => (store.raw(k).items || []).some(i => i.gamePassword === "pw1234"))
  ?.split("/")[1];
ok("มีออเดอร์ที่เก็บรหัสผ่านลูกค้าไว้ให้แอดมิน", !!orderId);
ok("สถานะเป็นรอดำเนินการ (ของเติมเกมต้องรอแอดมิน)",
  store.raw("orders/" + orderId).status === "pending", store.raw("orders/" + orderId).status);

section("แอดมินกดว่าทำเสร็จ = ลบรหัสผ่านลูกค้าอัตโนมัติ");
await makeAdmin(QQ, store);
fs2.notifyAll(); await tick(4);
await QQ.startOrder(orderId);
await QQ.completeOrder(orderId);
const after = store.raw("orders/" + orderId).items;
ok("รหัสผ่านถูกลบออก", after.every(i => !i.gamePassword));
ok("ชื่อผู้ใช้ถูกลบออก", after.every(i => !i.gameLogin));
ok("บันทึกเวลาที่ลบไว้", !!store.raw("orders/" + orderId).customerInfoClearedAt);
ok("สถานะเป็นสำเร็จ", store.raw("orders/" + orderId).status === "completed");

section("แอดมินยังลบรหัสผ่านด้วยมือได้ (ออเดอร์เก่า)");
store.put("orders/legacy1", {
  uid: QQ.user.uid, total: 80, status: "approved",
  items: [{ id: "pLogin", name: "เติมเกม", price: 80, qty: 1,
    gameUid: "999", gameLogin: "olduser", gamePassword: "oldpass" }],
});
await QQ.clearOrderCustomerInfo("legacy1");
const legacy = store.raw("orders/legacy1").items[0];
ok("ลบรหัสผ่านออกได้", !legacy.gamePassword);
ok("ไอดีเกม/UID ยังอยู่เป็นหลักฐาน", legacy.gameUid === "999");

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
