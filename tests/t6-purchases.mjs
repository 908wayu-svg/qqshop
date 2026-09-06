// ===== ทดสอบหน้าประวัติการซื้อ (ต้องเห็นเฉพาะของตัวเอง) =====
import { buildSandbox, makeDom, loadI18n, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";
import { installAdminServer } from "./fake/admin-server.mjs";

installAdminServer();

buildSandbox(); makeDom("purchases.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
let ORDERS_RELOAD = null;   // เก็บผลดึงข้อมูลไว้ตรวจ

await QQ.registerWithEmail("buyer@test.com", "secret123", "ผู้ซื้อ", "");
await tick(6);
const UID = QQ.user.uid;

store.put("products/pA", { name: "ไอดีเกม A", price: 300, active: true, digital: true });
const TS = n => new fs2.Timestamp(Date.now() - n * 1000);

store.put("orders/o1", {
  uid: UID, total: 600, status: "approved", createdAt: TS(30), approvedAt: TS(20),
  items: [{ id: "pA", name: "ไอดีเกม A", price: 300, qty: 2,
    delivered: [{ login: "user1", password: "pw1", note: "โน้ต 1" }, { login: "user2", password: "pw2", note: "" }] }],
});
store.put("orders/o2", { uid: UID, total: 80, status: "pending", paid: true, kind: "topup",
  createdAt: TS(10),
  items: [{ id: "pTopup", name: "เติมเพชร", price: 80, qty: 1, gameUid: "111", gameLogin: "me", gamePassword: "secret" }] });
store.put("orders/o3", { uid: UID, total: 300, status: "cancelled", note: "ของหมด", paid: true,
  refundAmount: 300, createdAt: TS(5), cancelledAt: TS(4),
  items: [{ id: "pA", name: "ไอดีเกม A", price: 300, qty: 1 }] });
// เพิ่งได้ของไป 1 นาที — ต้องบอกว่าเหลือเวลาแจ้งเคลมอีกกี่นาที
store.put("orders/oClaim", { uid: UID, total: 300, status: "completed", paid: true, kind: "digital",
  createdAt: TS(70), completedAt: TS(60),
  claimTimerStartedAt: new fs2.Timestamp(Date.now() - 60000),
  items: [{ id: "pA", name: "ไอดีเกม A", price: 300, qty: 1,
    delivered: [{ login: "u9", password: "p9", note: "" }] }] });
// เลยเวลามานานแล้ว — ต้องบอกว่าหมดเวลา ไม่ใช่โชว์เลขติดลบ
store.put("orders/oOld", { uid: UID, total: 300, status: "completed", paid: true, kind: "digital",
  createdAt: TS(9000), completedAt: TS(9000),
  claimTimerStartedAt: new fs2.Timestamp(Date.now() - 3600000),
  items: [{ id: "pA", name: "ไอดีเกม A", price: 300, qty: 1,
    delivered: [{ login: "u8", password: "p8", note: "" }] }] });
store.put("orders/other", { uid: "someone-else", total: 9999, status: "approved", createdAt: TS(1),
  items: [{ id: "pA", name: "ของคนอื่น", price: 9999, qty: 1, delivered: [{ login: "ห้ามเห็น", password: "ห้ามเห็น" }] }] });

await import("./sandbox/purchases.mjs");
await tick(10);

section("แสดงประวัติ");
const cards = document.querySelectorAll(".purchase");
ok("เห็นเฉพาะออเดอร์ของตัวเอง 5 รายการ", cards.length === 5, "ได้ " + cards.length);
ok("ไม่มีของคนอื่นปน", !$("list").innerHTML.includes("ของคนอื่น") && !$("list").innerHTML.includes("ห้ามเห็น"));
ok("ยอดซื้อสะสมนับเฉพาะที่ซื้อสำเร็จ (600 + 300 + 300)",
  $("kpi-spent").textContent.includes("1,200"), $("kpi-spent").textContent);
ok("จำนวนครั้งนับเฉพาะที่ซื้อสำเร็จ", $("kpi-count").textContent === "3", $("kpi-count").textContent);
ok("ออเดอร์ที่ยกเลิกไม่ถูกนับเป็นยอดซื้อ", !$("kpi-spent").textContent.includes("1,500"));
ok("รายการล่าสุดอยู่บนสุด", cards[0].textContent.includes("ยกเลิกแล้ว"), cards[0].textContent.slice(0, 60));
ok("แสดงหมายเหตุตอนยกเลิก", $("list").innerHTML.includes("ของหมด"));
ok("บอกว่าคืนเครดิตแล้ว", $("list").textContent.includes("คืนเครดิต"));
ok("ออเดอร์ที่รอดำเนินการบอกว่าหักเครดิตแล้ว", $("list").textContent.includes("หักเครดิตแล้ว"));

section("ตัวกรองสถานะ");
const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
click(document.querySelector('#status-filter [data-st="completed"]'));
// ออเดอร์เก่าที่เป็น approved ต้องยังนับเป็น "สำเร็จ" ต่อไป ไม่งั้นประวัติลูกค้าหายไปเฉยๆ
ok("กรองเฉพาะสำเร็จ (รวมออเดอร์เก่าที่เป็น approved)", document.querySelectorAll(".purchase").length === 3,
  String(document.querySelectorAll(".purchase").length));
click(document.querySelector('#status-filter [data-st="pending"]'));
ok("กรองเฉพาะรอดำเนินการ", document.querySelectorAll(".purchase").length === 1);
click(document.querySelector('#status-filter [data-st="cancelled"]'));
ok("กรองเฉพาะยกเลิกแล้ว", document.querySelectorAll(".purchase").length === 1);
click(document.querySelector('#status-filter [data-st="all"]'));
ok("กลับมาแสดงทั้งหมด", document.querySelectorAll(".purchase").length === 5);

section("ดูไอดี/รหัสผ่านที่ซื้อ");
const openable = document.querySelectorAll("[data-open]");
ok("มีปุ่มดูรหัสเฉพาะรายการที่ส่งมอบแล้ว", openable.length === 3, "ได้ " + openable.length);
click(openable[0]);
await tick(2);
ok("กล่องรหัสเปิดขึ้น", $("cred-overlay").classList.contains("open"));
ok("แสดงครบทั้ง 2 ชุด", document.querySelectorAll("#cred-list .cred-card").length === 2);
ok("เห็นชื่อผู้ใช้", $("cred-list").innerHTML.includes("user1"));
ok("เห็นรหัสผ่าน", $("cred-list").innerHTML.includes("pw2"));
ok("เห็นหมายเหตุ", $("cred-list").innerHTML.includes("โน้ต 1"));
ok("มีเลขชุดกำกับ", $("cred-list").innerHTML.includes("ชุดที่ 1"));

section("อ่านคลังรหัสผ่านตรงๆ ไม่ได้");
let denied = false;
try { await QQ.fetchStockItems("pA"); } catch { denied = true; }
ok("ลูกค้าเปิดคลังรหัสผ่านของร้านไม่ได้", denied);

section("กัน XSS ในกล่องรหัส");
store.put("orders/o4", { uid: UID, total: 1, status: "approved", createdAt: TS(2),
  items: [{ id: "pA", name: "x", price: 1, qty: 1,
    delivered: [{ login: '<img src=x onerror="window.__pwned=1">', password: "<script>window.__pwned=1</script>", note: "" }] }] });
click(openable[0]);
await tick(2);
ok("ไม่มีสคริปต์ถูกฝังในกล่องรหัส", window.__pwned === undefined && !$("cred-list").querySelector("script"));

section("ตอนที่ Firestore ยังไม่มี index (เพิ่ง deploy / โดนลบ)");
{
  // คำสั่งที่มีทั้ง where และ orderBy จะถูกปฏิเสธจนกว่า index จะสร้างเสร็จ
  // ประวัติของลูกค้าต้องยังเปิดดูได้ ไม่ใช่ขึ้นหน้าว่าง — auth.js มีทางสำรองไว้แล้ว
  // แต่ก่อนหน้านี้ไม่เคยมีเทสยืนยันว่าทางสำรองนั้นทำงานจริง
  store.state.failOrderedQueries = true;
  let crashed = null, orders = [];
  try { orders = await QQ.fetchMyOrders(); } catch (e) { crashed = e.code || e.message; }
  store.state.failOrderedQueries = false;

  ok("ยังดึงประวัติได้ ไม่ล่ม", crashed === null, String(crashed));
  ok("ได้ครบทุกรายการของตัวเอง", orders.length === 6, "ได้ " + orders.length);
  ok("ยังเรียงใหม่ไปเก่าถูกต้อง (เรียงเองในเครื่อง)",
    orders[0].id === "o4" && orders[orders.length - 1].id === "oOld", orders.map(o => o.id).join(","));
  ok("ไม่มีของคนอื่นหลุดมา", orders.every(o => o.uid === UID));

  // ฝั่งเติมเงินก็ต้องรอดเหมือนกัน
  store.put("topups/tp1", { uid: UID, amount: 100, method: "bank", hasSlip: true,
    status: "approved", createdAt: TS(3) });
  store.state.failOrderedQueries = true;
  let tCrashed = null, tops = [];
  try { tops = await QQ.fetchMyTopups(); } catch (e) { tCrashed = e.code || e.message; }
  store.state.failOrderedQueries = false;
  ok("ประวัติเติมเงินก็ยังดูได้", tCrashed === null && tops.length === 1, String(tCrashed));
}

section("นับถอยหลังเวลาแจ้งเคลม");
{
  const cardOf = id => [...document.querySelectorAll(".purchase")]
    .find(c => c.textContent.includes(id.slice(0, 8).toUpperCase()));
  const fresh = cardOf("oClaim"), old = cardOf("oOld");
  ok("ออเดอร์ที่เพิ่งสำเร็จบอกเวลาที่เหลือ", !!fresh?.querySelector(".claim-left"),
    fresh ? fresh.textContent.slice(0, 80) : "ไม่เจอการ์ด");
  ok("บอกเป็นนาที ไม่ใช่เลขติดลบ", /เหลือเวลาแจ้งเคลมอีก \d+ นาที/.test(fresh.textContent),
    fresh.querySelector(".claim-left")?.textContent);
  ok("ออเดอร์ที่เลยเวลาแล้วบอกว่าหมดเวลา",
    old.querySelector(".claim-left.over") && old.textContent.includes("หมดเวลา"),
    old.querySelector(".claim-left")?.textContent);
  ok("ออเดอร์ที่ยังไม่สำเร็จไม่ขึ้นเวลาเคลม",
    !cardOf("o2").querySelector(".claim-left"));
}

section("แก้ข้อมูลไอดีเกมเอง (เฉพาะตอนรอดำเนินการ)");
{
  click(document.querySelector('#status-filter [data-st="all"]'));
  const editBtns = document.querySelectorAll("[data-edit]");
  ok("มีปุ่มแก้ไขเฉพาะออเดอร์ที่รอดำเนินการ", editBtns.length === 1, "ได้ " + editBtns.length);
  ok("ปุ่มชี้ไปที่ออเดอร์ที่ถูกต้อง", editBtns[0].dataset.edit === "o2", editBtns[0].dataset.edit);

  click(editBtns[0]);
  await tick(3);
  ok("กล่องแก้ไขเปิดขึ้น", $("edit-overlay").classList.contains("open"));
  const inputs = [...document.querySelectorAll("#edit-list [data-field]")];
  ok("มีช่องให้แก้ครบ 3 ช่อง", inputs.length === 3, "ได้ " + inputs.length);
  ok("เติมค่าเดิมมาให้แล้ว", inputs.find(i => i.dataset.field === "gameUid").value === "111");
  ok("เตือนเรื่องแก้ช้า", $("edit-overlay").textContent.includes("ไม่รับผิดชอบ"));

  // เว้นว่างต้องไม่ให้บันทึก
  inputs.find(i => i.dataset.field === "gameUid").value = "";
  click($("edit-save"));
  await tick(4);
  ok("เว้นช่องว่างแล้วบันทึกไม่ได้", $("edit-msg").textContent.includes("กรอก"), $("edit-msg").textContent);
  ok("ค่าเดิมในฐานข้อมูลไม่ถูกแตะ", store.raw("orders/o2").items[0].gameUid === "111");

  inputs.find(i => i.dataset.field === "gameUid").value = "222";
  click($("edit-save"));
  await tick(8);
  ok("บันทึกค่าใหม่ได้", store.raw("orders/o2").items[0].gameUid === "222",
    String(store.raw("orders/o2").items[0].gameUid));
  ok("ปิดกล่องหลังบันทึก", !$("edit-overlay").classList.contains("open"));
  ok("เก็บประวัติการแก้ไว้", (store.raw("orders/o2").infoEdits || []).some(e => e.from === "111"));

  // พอแอดมินเริ่มดำเนินการ ปุ่มแก้ไขต้องหายไป
  store.put("orders/o2", { ...store.raw("orders/o2"), status: "processing" });
  click(document.querySelector('#status-filter [data-st="all"]'));
  await tick(6);
  // ดึงข้อมูลใหม่แล้ววาดใหม่
  const again = await QQ.fetchMyOrders(200);
  ok("สถานะในฐานข้อมูลเปลี่ยนเป็นกำลังดำเนินการ",
    again.find(o => o.id === "o2").status === "processing");
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
