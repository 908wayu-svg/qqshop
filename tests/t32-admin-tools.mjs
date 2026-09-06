// ===== ทดสอบเครื่องมือแอดมินชุดใหม่ =====
//   ค้นหาออเดอร์ด้วยเลขที่คำสั่งซื้อ · ประวัติของสมาชิกรายคน ·
//   แท็บบันทึกการกระทำของแอดมิน · ซ่อน/เลิกซ่อนรายการจากหน้าประวัติของลูกค้า
import { buildSandbox, makeDom, loadI18n, tick, makeAdmin } from "./harness.mjs";
import { installAdminServer, calls } from "./fake/admin-server.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";

buildSandbox(); const dom = makeDom("admin.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const rows = id => $(id).querySelectorAll("tbody tr");
const TS = n => new fs2.Timestamp(Date.now() - n * 1000);

await QQ.registerWithEmail("908wayu@gmail.com", "adminpass", "เจ้าของร้าน", "");
installAdminServer();
await makeAdmin(QQ, store);
await tick(6);

// ---------- ข้อมูลตั้งต้น ----------
store.put("users/c1", { uid: "c1", email: "somchai@x.com", name: "สมชาย ใจดี", role: "member", credit: 250, createdAt: TS(900), provider: "email" });
store.put("users/c2", { uid: "c2", email: "malee@x.com", name: "มาลี รักเรียน", role: "member", credit: 40, createdAt: TS(800), provider: "google" });

store.put("products/pA", { name: "ไอดีเกม A", price: 300, stock: 2, active: true, digital: true });

// รหัสออเดอร์ยาวพอให้ตัด 8 ตัวแรกเป็น "เลขที่คำสั่งซื้อ" ได้จริง (เหมือน Firestore auto-id)
const OID = "a1b2c3d4e5f6g7h8";
store.put("orders/" + OID, {
  uid: "c1", customerName: "สมชาย ใจดี", customerEmail: "somchai@x.com", total: 300,
  status: "completed", paid: true, kind: "digital", createdAt: TS(300), completedAt: TS(290),
  items: [{ id: "pA", name: "ไอดีเกม A", price: 300, qty: 1, delivered: [{ login: "u1", password: "p1" }] }],
});
store.put("orders/zz9988776655", {
  uid: "c2", customerName: "มาลี รักเรียน", customerEmail: "malee@x.com", total: 300,
  status: "pending", paid: true, kind: "topup", createdAt: TS(200),
  items: [{ id: "pA", name: "ไอดีเกม A", price: 300, qty: 1 }],
});
store.put("orders/old111222333", {
  uid: "c1", customerName: "สมชาย ใจดี", customerEmail: "somchai@x.com", total: 300,
  status: "cancelled", paid: true, createdAt: TS(150),
  items: [{ id: "pA", name: "ไอดีเกม A", price: 300, qty: 1 }],
});

store.put("topups/tp111", { uid: "c1", name: "สมชาย ใจดี", email: "somchai@x.com", amount: 500,
  method: "bank", hasSlip: true, status: "approved", createdAt: TS(400) });
store.put("topups/tp222", { uid: "c2", name: "มาลี รักเรียน", email: "malee@x.com", amount: 100,
  method: "angpao", angpaoLink: "https://gift.truemoney.com/campaign/?v=X", status: "pending", createdAt: TS(100) });

const ADMIN = await import("./sandbox/admin.mjs");
const reload = async () => { await ADMIN.reloadAll(); await tick(6); };
await tick(12);

// =====================================================================
section("ค้นหาออเดอร์ด้วยเลขที่คำสั่งซื้อ");

const search = $("order-search");
ok("มีช่องค้นหาในแท็บออเดอร์", !!search);
ok("ตารางออเดอร์โชว์คอลัมน์เลขที่คำสั่งซื้อ", $("table-orders").innerHTML.includes("order-no"));

// เลขที่ที่ลูกค้าเห็น = 8 ตัวแรกแบบตัวใหญ่ (ต้องตรงกับ purchases.js)
const SHOWN = OID.slice(0, 8).toUpperCase();
// ตอนนี้ตัวกรองยังเป็น "รอดำเนินการ" จึงเทียบกับใบที่ค้างอยู่ ไม่ใช่ใบที่สำเร็จแล้ว
ok("เลขที่ในตารางตรงกับที่ลูกค้าเห็น",
  $("table-orders").innerHTML.includes("ZZ998877"), $("table-orders").textContent.slice(0, 40));

const type = v => { search.value = v; search.dispatchEvent(new window.Event("input", { bubbles: true })); };

// ตัวกรองเริ่มที่ "รอดำเนินการ" — ออเดอร์ใบนี้ completed จึงไม่อยู่ในตารางตอนแรก
ok("ก่อนค้นหา ตัวกรองสถานะยังทำงานตามเดิม", rows("table-orders").length === 1);

type(SHOWN);
ok("ค้นด้วยเลขที่แล้วเจอ 1 รายการ", rows("table-orders").length === 1);
ok("เจอใบที่ถูกต้อง แม้สถานะไม่ตรงตัวกรอง", $("table-orders").innerHTML.includes(SHOWN));

type("#" + SHOWN.toLowerCase() + "  ");
ok("ใส่ # / ตัวเล็ก / เว้นวรรค ก็ยังเจอ", rows("table-orders").length === 1);

type("มาลี");
ok("ค้นด้วยชื่อลูกค้าก็ได้", rows("table-orders").length === 1
  && $("table-orders").innerHTML.includes("มาลี"));

type("somchai@x.com");
ok("ค้นด้วยอีเมลเจอทุกสถานะของคนนั้น", rows("table-orders").length === 2);

type("ไม่มีจริง");
ok("ไม่เจอ ต้องบอกว่าไม่พบ (ไม่ใช่ 'ยังไม่มีข้อมูล')",
  $("table-orders").textContent.includes("ไม่พบ"), $("table-orders").textContent.trim());

ok("ปุ่มล้างการค้นหาโผล่ตอนมีคำค้น", !$("order-search-clear").classList.contains("hidden"));
click($("order-search-clear"));
ok("ล้างแล้วช่องว่าง", search.value === "");
ok("ล้างแล้วกลับไปใช้ตัวกรองสถานะเดิม", rows("table-orders").length === 1);
ok("ปุ่มล้างซ่อนกลับ", $("order-search-clear").classList.contains("hidden"));

// =====================================================================
section("ประวัติของสมาชิกรายคน");

click(document.querySelector('#tabs [data-tab="members"]'));
const histBtn = document.querySelector('#table-members [data-act="member-history"]');
ok("มีปุ่มประวัติในแถวสมาชิก", !!histBtn);

// แถวแรกในตารางสมาชิกคือคนที่สมัครล่าสุด — หาแถวของ c1 ให้ชัด
const btnFor = uid => document.querySelector(`#table-members [data-act="member-history"][data-id="${uid}"]`);
click(btnFor("c1"));
await tick(4);
ok("กล่องประวัติเปิดขึ้น", $("member-overlay").classList.contains("open"));
ok("บอกว่าเป็นประวัติของใคร", $("mh-who").textContent.includes("สมชาย")
  && $("mh-who").textContent.includes("somchai@x.com"), $("mh-who").textContent);
ok("เห็นเฉพาะออเดอร์ของคนนั้น (2 ใบ)", rows("mh-orders").length === 2, String(rows("mh-orders").length));
ok("ไม่มีออเดอร์ของคนอื่นปน", !$("mh-orders").innerHTML.includes("มาลี"));
ok("เห็นเฉพาะการเติมเงินของคนนั้น", rows("mh-topups").length === 1);
ok("ยอดซื้อสำเร็จนับเฉพาะที่สำเร็จจริง", $("mh-spent").textContent.includes("300"), $("mh-spent").textContent);
ok("ยอดเติมนับเฉพาะที่อนุมัติแล้ว", $("mh-topup").textContent.includes("500"), $("mh-topup").textContent);
ok("โชว์เครดิตคงเหลือปัจจุบัน", $("mh-credit").textContent.includes("250"), $("mh-credit").textContent);
ok("ตารางในกล่องมี data-label ครบ (มือถือแปลงเป็นการ์ด)",
  [...$("mh-orders").querySelectorAll("tbody td")].every(td => td.hasAttribute("data-label")));

window.closePanel("member-overlay");
click(btnFor("c2"));
await tick(4);
ok("สลับไปดูอีกคนได้ ข้อมูลเปลี่ยนตาม", rows("mh-orders").length === 1
  && $("mh-orders").innerHTML.includes("มาลี") === false, $("mh-who").textContent);
ok("ยอดซื้อของคนที่ยังไม่มีออเดอร์สำเร็จ = 0", $("mh-spent").textContent.includes("0"));
window.closePanel("member-overlay");

// =====================================================================
section("ซ่อน/เลิกซ่อนรายการจากหน้าประวัติของลูกค้า");

click(document.querySelector('#tabs [data-tab="orders"]'));
click(document.querySelector('#orders-filter [data-st="all"]'));
const hideBtn = document.querySelector(`#table-orders [data-act="hide-order"][data-id="${OID}"]`);
ok("มีปุ่มซ่อนในแถวออเดอร์", !!hideBtn);

globalThis.__confirm = true;
calls.length = 0;
click(hideBtn);
await tick(10);
ok("ยิงไปที่เส้นทางซ่อนของเซิร์ฟเวอร์", calls.some(c => c.path === "/admin/order/hide"),
  JSON.stringify(calls.map(c => c.path)));
ok("เซิร์ฟเวอร์ตั้ง hiddenAt ให้จริง", !!store.raw("orders/" + OID).hiddenAt);
ok("ไม่ได้ลบข้อมูลทิ้ง (ยอดเงินยังอยู่)", store.raw("orders/" + OID).total === 300);
ok("สถานะออเดอร์ไม่เปลี่ยน", store.raw("orders/" + OID).status === "completed");
ok("หลังบ้านยังเห็นออเดอร์ใบนี้อยู่",
  $("table-orders").innerHTML.includes(SHOWN));
ok("มีป้ายบอกว่าซ่อนจากลูกค้าแล้ว", $("table-orders").innerHTML.includes("ซ่อนจากลูกค้าแล้ว"));
ok("ปุ่มเปลี่ยนเป็น 'เลิกซ่อน'",
  !!document.querySelector(`#table-orders [data-act="unhide-order"][data-id="${OID}"]`));

// ยอดขายในภาพรวมต้องไม่เปลี่ยน — การซ่อนเป็นเรื่องหน้าจอลูกค้าเท่านั้น
const salesAfterHide = $("kpi-sales").textContent;
click(document.querySelector(`#table-orders [data-act="unhide-order"][data-id="${OID}"]`));
await tick(10);
ok("เลิกซ่อนแล้ว hiddenAt เป็น null", store.raw("orders/" + OID).hiddenAt === null);
ok("ยอดขายไม่ขยับตลอดทั้งกระบวนการ", $("kpi-sales").textContent === salesAfterHide, $("kpi-sales").textContent);

// ---------- เติมเงิน ----------
click(document.querySelector('#tabs [data-tab="topups"]'));
const hideTopup = document.querySelector('#table-topups [data-act="hide-topup"][data-id="tp222"]');
ok("มีปุ่มซ่อนในแถวเติมเงินด้วย", !!hideTopup);
click(hideTopup);
await tick(10);
ok("ซ่อนรายการเติมเงินได้", !!store.raw("topups/tp222").hiddenAt);
ok("ยอดเงินของรายการเติมไม่ถูกแตะ", store.raw("topups/tp222").amount === 100);

// ---------- กดยกเลิกตอนถามยืนยัน ต้องไม่เกิดอะไรขึ้น ----------
globalThis.__confirm = false;
calls.length = 0;
click(document.querySelector('#table-topups [data-act="unhide-topup"][data-id="tp222"]'));
await tick(6);
ok("กดยกเลิกตอนยืนยัน = ไม่ยิงเซิร์ฟเวอร์", !calls.some(c => c.path === "/admin/topup/hide"));
ok("ค่ายังเป็นซ่อนอยู่เหมือนเดิม", !!store.raw("topups/tp222").hiddenAt);
globalThis.__confirm = true;

// =====================================================================
section("แท็บบันทึกการกระทำของแอดมิน");

ok("มีแท็บบันทึกแอดมิน", !!document.querySelector('#tabs [data-tab="logs"]'));
ok("ยังไม่โหลดบันทึกก่อนเปิดแท็บ (ประหยัดโควตาอ่าน)",
  $("table-logs").innerHTML.trim() === "");

click(document.querySelector('#tabs [data-tab="logs"]'));
await tick(12);
ok("เปิดแท็บแล้วโหลดบันทึกเอง", rows("table-logs").length > 0, $("table-logs").textContent.trim().slice(0, 60));
ok("เห็นการกระทำ 'ซ่อน/เลิกซ่อนออเดอร์'", $("table-logs").textContent.includes("ซ่อน/เลิกซ่อนออเดอร์"));
ok("บอกว่าใครทำ", $("table-logs").textContent.includes("908wayu@gmail.com"));
ok("แปลงรหัสสมาชิกเป็นชื่อคนให้อ่านง่าย", $("table-logs").textContent.includes("สมชาย ใจดี"));
ok("บันทึกทุกแถวมี data-label",
  [...$("table-logs").querySelectorAll("tbody td")].every(td => td.hasAttribute("data-label")));

// เรียงใหม่ไปเก่า
const logDates = [...$("table-logs").querySelectorAll("tbody tr td:first-child")].map(td => td.textContent);
ok("มีหลายรายการให้เรียง", logDates.length >= 3, String(logDates.length));

// ปรับเครดิตแล้วต้องมีบันทึกใหม่โผล่หลังกดโหลดใหม่
const before = rows("table-logs").length;
await QQ.adjustCredit("c1", 50, "ทดสอบ");
click($("btn-reload-logs"));
await tick(12);
ok("กดโหลดใหม่แล้วเห็นบันทึกที่เพิ่งเกิด", rows("table-logs").length > before,
  before + " -> " + rows("table-logs").length);
ok("บันทึกปรับเครดิตบอกยอดก่อน/หลัง", $("table-logs").textContent.includes("250")
  && $("table-logs").textContent.includes("300"));

// ---------- สมาชิกธรรมดาต้องอ่านบันทึกไม่ได้ ----------
section("สิทธิ์: สมาชิกธรรมดาอ่านบันทึกแอดมินไม่ได้");
await QQ.logout();
await QQ.registerWithEmail("member@x.com", "memberpass", "สมาชิกธรรมดา", "");
await tick(6);
let denied = false;
try { await QQ.fetchAdminLogs(); } catch (e) { denied = e.code === "permission-denied"; }
ok("อ่าน adminLogs ไม่ได้", denied);

let hideDenied = "";
try { await QQ.setOrderHidden(OID, true); } catch (e) { hideDenied = e.adminCode || e.message; }
ok("สั่งซ่อนออเดอร์ไม่ได้", hideDenied === "ADMIN_ONLY", hideDenied);

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
process.exitCode = fail ? 1 : 0;
