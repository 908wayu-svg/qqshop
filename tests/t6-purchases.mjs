// ===== ทดสอบหน้าประวัติการซื้อ (ต้องเห็นเฉพาะของตัวเอง) =====
import { buildSandbox, makeDom, loadI18n, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";

buildSandbox(); makeDom("purchases.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);

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
store.put("orders/o2", { uid: UID, total: 300, status: "pending", createdAt: TS(10),
  items: [{ id: "pA", name: "ไอดีเกม A", price: 300, qty: 1 }] });
store.put("orders/o3", { uid: UID, total: 300, status: "rejected", note: "สลิปไม่ชัด", createdAt: TS(5),
  items: [{ id: "pA", name: "ไอดีเกม A", price: 300, qty: 1 }] });
store.put("orders/other", { uid: "someone-else", total: 9999, status: "approved", createdAt: TS(1),
  items: [{ id: "pA", name: "ของคนอื่น", price: 9999, qty: 1, delivered: [{ login: "ห้ามเห็น", password: "ห้ามเห็น" }] }] });

await import("./sandbox/purchases.mjs");
await tick(10);

section("แสดงประวัติ");
const cards = document.querySelectorAll(".purchase");
ok("เห็นเฉพาะออเดอร์ของตัวเอง 3 รายการ", cards.length === 3, "ได้ " + cards.length);
ok("ไม่มีของคนอื่นปน", !$("list").innerHTML.includes("ของคนอื่น") && !$("list").innerHTML.includes("ห้ามเห็น"));
ok("ยอดซื้อสะสมนับเฉพาะที่อนุมัติ", $("kpi-spent").textContent.includes("600"), $("kpi-spent").textContent);
ok("จำนวนครั้งนับเฉพาะที่อนุมัติ", $("kpi-count").textContent === "1", $("kpi-count").textContent);
ok("รายการล่าสุดอยู่บนสุด", cards[0].textContent.includes("ไม่อนุมัติ"));
ok("แสดงหมายเหตุตอนไม่อนุมัติ", $("list").innerHTML.includes("สลิปไม่ชัด"));

section("ตัวกรองสถานะ");
const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
click(document.querySelector('#status-filter [data-st="approved"]'));
ok("กรองเฉพาะอนุมัติแล้ว", document.querySelectorAll(".purchase").length === 1);
click(document.querySelector('#status-filter [data-st="pending"]'));
ok("กรองเฉพาะรออนุมัติ", document.querySelectorAll(".purchase").length === 1);
click(document.querySelector('#status-filter [data-st="all"]'));
ok("กลับมาแสดงทั้งหมด", document.querySelectorAll(".purchase").length === 3);

section("ดูไอดี/รหัสผ่านที่ซื้อ");
const openable = document.querySelectorAll("[data-open]");
ok("มีปุ่มดูรหัสเฉพาะรายการที่ส่งมอบแล้ว", openable.length === 1, "ได้ " + openable.length);
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
  ok("ได้ครบทุกรายการของตัวเอง", orders.length === 4, "ได้ " + orders.length);
  ok("ยังเรียงใหม่ไปเก่าถูกต้อง (เรียงเองในเครื่อง)",
    orders[0].id === "o4" && orders[orders.length - 1].id === "o1", orders.map(o => o.id).join(","));
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

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
