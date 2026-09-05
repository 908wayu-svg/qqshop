// ===== ทดสอบภาระงานเมื่อมีผู้ใช้เยอะ (หน้าเว็บต้องไม่ค้าง) =====
import { buildSandbox, makeDom, loadI18n, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";

buildSandbox(); makeDom("admin.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const bytes = o => Buffer.byteLength(JSON.stringify(o, (k, v) => v?.ms ? v.ms : v));
const mb = n => (n / 1048576).toFixed(1) + " MB";

await QQ.registerWithEmail("908wayu@gmail.com", "adminpass", "เจ้าของร้าน", "");
await tick(6);

// สลิปจริงหลังย่อรูปแล้วอยู่ราว 120 KB
const SLIP = "data:image/jpeg;base64," + "A".repeat(120000) + "==";
const TS = n => new fs2.Timestamp(Date.now() - n * 1000);

const N_USERS = 300, N_ORDERS = 500, N_TOPUPS = 500, N_PRODUCTS = 60;
for (let i = 0; i < N_USERS; i++) {
  store.put("users/m" + i, { uid: "m" + i, email: "m" + i + "@x.com", name: "ลูกค้า " + i,
    role: "member", credit: i * 3, createdAt: TS(100000 - i * 100), provider: "email" });
}
for (let i = 0; i < N_PRODUCTS; i++) {
  store.put("products/p" + i, { name: "สินค้า " + i, price: 100 + i, stock: 5, active: true,
    image: "data:image/jpeg;base64," + "B".repeat(150000) + "==" });
}
for (let i = 0; i < N_ORDERS; i++) {
  store.put("orders/o" + i, { uid: "m" + (i % N_USERS), customerName: "ลูกค้า " + (i % N_USERS),
    customerEmail: "x@x.com", total: 300, status: i % 3 === 0 ? "pending" : "approved",
    createdAt: TS(90000 - i * 100), approvedAt: TS(89000 - i * 100),
    items: [{ id: "p" + (i % N_PRODUCTS), name: "สินค้า " + (i % N_PRODUCTS), price: 100 + (i % N_PRODUCTS), qty: 1 }] });
}
for (let i = 0; i < N_TOPUPS; i++) {
  store.put("topups/t" + i, { uid: "m" + (i % N_USERS), name: "ลูกค้า " + i, email: "x@x.com",
    amount: 100, method: "bank", hasSlip: true, status: i % 4 === 0 ? "pending" : "approved",
    createdAt: TS(80000 - i * 100) });
  store.put("topupSlips/t" + i, { uid: "m" + (i % N_USERS), slip: SLIP });
}

section("ขนาดข้อมูลที่หน้าแอดมินต้องโหลด");
const topups = await QQ.fetchTopups();
const orders = await QQ.fetchOrders();
const users = await QQ.fetchUsers();
const topupBytes = bytes(topups);
console.log("   เติมเงิน " + topups.length + " รายการ = " + mb(topupBytes));
ok("ตารางเติมเงินเบา (< 1 MB) เพราะสลิปแยกเอกสาร", topupBytes < 1048576, mb(topupBytes));
const wouldBe = N_TOPUPS * SLIP.length;
console.log("   ถ้ายังฝังสลิปในเอกสารเหมือนเดิมจะเป็น " + mb(wouldBe));
ok("เบาลงจากเดิมอย่างน้อย 50 เท่า", wouldBe / topupBytes > 50, (wouldBe / topupBytes).toFixed(0) + " เท่า");
ok("ดึงออเดอร์ครบ", orders.length === N_ORDERS, "ได้ " + orders.length);
ok("ดึงสมาชิกครบ", users.length === N_USERS + 1, "ได้ " + users.length);

section("เวลาวาดหน้าจอ");
const t0 = Date.now();
await import("./sandbox/admin.mjs");
await tick(20);
const ms = Date.now() - t0;
console.log("   วาดหน้าหลังบ้านทั้งหมดใช้ " + ms + " ms");
ok("วาดเสร็จภายใน 8 วินาที", ms < 8000, ms + " ms");
ok("ตารางออเดอร์ตัดที่ 100 แถว ไม่วาดหมดทีเดียว",
  $("table-orders").querySelectorAll("tbody tr").length <= 100,
  $("table-orders").querySelectorAll("tbody tr").length + " แถว");
ok("ตารางเติมเงินตัดที่ 100 แถว", $("table-topups").querySelectorAll("tbody tr").length <= 100);
ok("ตารางสมาชิกตัดที่ 200 แถว", $("table-members").querySelectorAll("tbody tr").length <= 200);
ok("ไม่มีรูป base64 ฝังในตารางเติมเงิน", !$("table-topups").innerHTML.includes("data:image"));

section("ตัวเลขสรุปยังถูกต้องแม้ข้อมูลเยอะ");
ok("นับสมาชิกครบ", $("kpi-members").textContent === String(N_USERS + 1), $("kpi-members").textContent);
const totalCredit = users.reduce((s, u) => s + Number(u.credit || 0), 0);
ok("รวมเครดิตถูกต้อง", $("kpi-credit").textContent.includes(totalCredit.toLocaleString("th-TH")),
  $("kpi-credit").textContent + " ควรเป็น " + totalCredit);

section("สลับตัวกรอง/แท็บรัวๆ ไม่ค้าง");
const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const t1 = Date.now();
for (let i = 0; i < 20; i++) {
  click(document.querySelector('#orders-filter [data-st="all"]'));
  click(document.querySelector('#orders-filter [data-st="pending"]'));
  click(document.querySelector('#tabs [data-tab="topups"]'));
  click(document.querySelector('#tabs [data-tab="overview"]'));
}
const ms2 = Date.now() - t1;
console.log("   สลับ 80 ครั้งใช้ " + ms2 + " ms");
ok("สลับแท็บ/ตัวกรองลื่น (< 10 วินาที ต่อ 80 ครั้ง)", ms2 < 10000, ms2 + " ms");

section("ช่วงเวลา 'ทั้งหมด' (กราฟย้อนหลังไกล)");
const t2 = Date.now();
click(document.querySelector('#range-filter [data-range="all"]'));
await tick(4);
console.log("   วาดกราฟย้อนหลังทั้งหมดใช้ " + (Date.now() - t2) + " ms");
ok("กราฟย้อนหลังทั้งหมดวาดได้", $("chart-sales").querySelector("svg") !== null);
ok("ไม่ค้างเกิน 5 วินาที", Date.now() - t2 < 5000);

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
