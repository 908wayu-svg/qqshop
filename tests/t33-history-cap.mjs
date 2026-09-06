// ===== ประวัติของลูกค้าที่ยาวเกินกว่าที่ดึงมาได้ครั้งเดียว =====
// หน้าประวัติดึงได้ครั้งละ 200 รายการ (หน้าเติมเงินตรวจใน t8-wallet.mjs)
// ถ้าลูกค้ามีมากกว่านั้นแล้วไม่บอกอะไรเลย เขาจะคิดว่ารายการเก่าหายไปจากระบบ
// และ "ยอดซื้อสะสม" ที่โชว์อยู่ก็ต่ำกว่าความจริงโดยไม่มีใครรู้
import { buildSandbox, makeDom, loadI18n, tick } from "./harness.mjs";
import { installAdminServer } from "./fake/admin-server.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";

installAdminServer();

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const TS = n => new fs2.Timestamp(Date.now() - n * 1000);

// ---------- หน้าประวัติการซื้อ ----------
buildSandbox(); makeDom("purchases.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

await QQ.registerWithEmail("many@test.com", "secret123", "ลูกค้าประจำ", "");
await tick(6);
const UID = QQ.user.uid;
store.put("products/pA", { name: "ไอดีเกม A", price: 5, active: true, digital: true });

// 200 ใบพอดี = ชนเพดานที่หน้าดึงได้ครั้งเดียว
for (let n = 0; n < 200; n++) {
  store.put("orders/many" + String(n).padStart(4, "0"), {
    uid: UID, total: 5, status: "completed", paid: true, kind: "digital",
    createdAt: TS(2000 + n), items: [{ id: "pA", name: "ไอดีเกม A", price: 5, qty: 1 }],
  });
}

await import("./sandbox/purchases.mjs");
await tick(14);

section("หน้าประวัติการซื้อ");
ok("มีที่สำหรับบอกลูกค้า", !!$("history-note"));
ok("ชนเพดานแล้วบอกลูกค้า", !$("history-note").classList.contains("hidden"),
  "ยังซ่อนอยู่: " + $("history-note").textContent);
ok("บอกจำนวนที่แสดงอยู่", $("history-note").textContent.includes("200"),
  $("history-note").textContent);
ok("บอกทางออกให้ด้วย (ทักแอดมินพร้อมเลขที่)", $("history-note").textContent.includes("แอดมิน"),
  $("history-note").textContent);
ok("ยอดซื้อสะสมบอกว่านับจากเท่าไหร่", $("kpi-spent").textContent.includes("นับจาก"),
  $("kpi-spent").textContent);
ok("ยังโชว์รายการให้ดูตามปกติ", document.querySelectorAll("#list .purchase").length === 200,
  String(document.querySelectorAll("#list .purchase").length));

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
