// ===== ทดสอบหน้าหลังบ้าน (รันโค้ดจริงบน DOM จำลอง) =====
import { buildSandbox, makeDom, loadI18n, tick, makeAdmin } from "./harness.mjs";
import { installAdminServer } from "./fake/admin-server.mjs";
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
const TS = n => new fs2.Timestamp(Date.now() - n * 1000);
const IMG = "data:image/jpeg;base64," + "A".repeat(100) + "==";

// ตัวอ่านสลิปจำลอง — เทสต้องไม่ยิงเน็ตจริงไปโหลดไลบรารี OCR (และไม่ต้องรอเพดานเวลา)
window.Tesseract = { recognize: async () => ({ data: { text: "จำนวนเงิน\n500.00 บาท\n5 ก.ย. 69 10:00" } }) };

await QQ.registerWithEmail("908wayu@gmail.com", "adminpass", "เจ้าของร้าน", "");
installAdminServer();
await makeAdmin(QQ, store);
await tick(6);
const ADMIN_UID = QQ.user.uid;

// ---------- ข้อมูลตั้งต้น ----------
store.put("users/c1", { uid: "c1", email: "c1@x.com", name: "ลูกค้า หนึ่ง", role: "member", credit: 1000, createdAt: TS(500), provider: "email" });
store.put("users/c2", { uid: "c2", email: "c2@x.com", name: "ลูกค้า สอง", role: "member", credit: 20, createdAt: TS(400), provider: "google" });
store.put("users/c3", { uid: "c3", email: "c3@x.com", name: "สมาชิกเก่าไม่มีวันที่", role: "member", credit: 77 });  // ไม่มี createdAt

store.put("products/pA", { name: "ไอดีเกม A", price: 300, stock: 3, active: true, digital: true, image: IMG });
store.put("products/pB", { name: "ของทั่วไป", price: 50, stock: 10, active: true });
store.put("products/pA/stockItems/s1", { login: "u1", password: "p1", note: "", status: "available", sort: 1 });
store.put("products/pA/stockItems/s2", { login: "u2", password: "p2", note: "", status: "sold", sort: 2 });
store.put("products/pA/stockItems/s3", { login: "u3", password: "p3", note: "", status: "available", sort: 3 });

store.put("orders/o1", { uid: "c1", customerName: "ลูกค้า หนึ่ง", customerEmail: "c1@x.com", total: 600, status: "pending",
  createdAt: TS(100), items: [{ id: "pA", name: "ไอดีเกม A", price: 300, qty: 2 }] });
store.put("orders/o2", { uid: "c1", customerName: "ลูกค้า หนึ่ง", customerEmail: "c1@x.com", total: 1, status: "pending",
  createdAt: TS(90),
  items: [{ id: "pA", name: "ไอดีเกม A", price: 300, qty: 2, gameUid: "99887766" }] });   // ยอดไม่ตรงราคาจริง + มีไอดีเกมให้คัดลอก
store.put("orders/o3", { uid: "c2", customerName: "ลูกค้า สอง", customerEmail: "c2@x.com", total: 50, status: "approved",
  createdAt: TS(80), approvedAt: TS(70), items: [{ id: "pB", name: "ของทั่วไป", price: 50, qty: 1 }] });
store.put("orders/o4", { uid: "c2", customerName: "ลูกค้า สอง", customerEmail: "c2@x.com", total: 5, status: "pending",
  createdAt: TS(60), items: [{ id: "ไม่มีสินค้านี้แล้ว", name: "ของที่ถูกลบ", price: 5, qty: 1 }] });

store.put("topups/t1", { uid: "c1", name: "ลูกค้า หนึ่ง", email: "c1@x.com", amount: 500, method: "bank",
  hasSlip: true, status: "pending", createdAt: TS(50) });
store.put("topupSlips/t1", { uid: "c1", slip: IMG });
store.put("topups/t2", { uid: "c1", name: "ลูกค้า หนึ่ง", email: "c1@x.com", amount: 0, method: "angpao",
  angpaoLink: "https://gift.truemoney.com/campaign/?v=ABC123", status: "pending", note: "ต้องตรวจสอบด้วยมือ", createdAt: TS(40) });
store.put("topups/t3", { uid: "c2", name: "ลูกค้า สอง", email: "c2@x.com", amount: 99, method: "angpao",
  status: "processing", createdAt: TS(30) });
store.put("topups/t4", { uid: "c2", name: "ลูกค้า สอง", email: "c2@x.com", amount: 30, method: "truewallet",
  slip: "ไม่ใช่รูป<script>", status: "pending", createdAt: TS(20) });   // ข้อมูลผิดปกติแบบเก่า

await import("./sandbox/admin.mjs");
await tick(12);

section("เข้าหลังบ้าน");
ok("แดชบอร์ดเปิดให้แอดมิน", !$("dash").classList.contains("hidden"));
ok("ไม่มีหน้ากั้น", $("gate").classList.contains("hidden"));

section("ภาพรวม");
ok("ยอดขายนับเฉพาะที่อนุมัติแล้ว", $("kpi-sales").textContent.includes("50"), $("kpi-sales").textContent);
ok("นับสมาชิกครบ รวมคนที่ไม่มีวันที่สมัคร", $("kpi-members").textContent === "4", $("kpi-members").textContent);
ok("เครดิตคงเหลือรวมนับครบทุกคน", $("kpi-credit").textContent.includes("1,097"), $("kpi-credit").textContent);
ok("นับออเดอร์รออนุมัติ", $("kpi-pending-orders").textContent === "3", $("kpi-pending-orders").textContent);
ok("นับเติมเงินรออนุมัติ (รวมที่ค้างอยู่)", $("kpi-pending-topups").textContent === "4", $("kpi-pending-topups").textContent);
ok("ป้ายแจ้งเตือนบนแท็บออเดอร์", $("pill-orders").textContent === "3" && !$("pill-orders").classList.contains("hidden"));
ok("กราฟยอดขายวาดได้", $("chart-sales").querySelector("svg, .chart-empty") !== null);
ok("กราฟสมาชิกใหม่วาดได้", $("chart-members").querySelector("svg, .chart-empty") !== null);
ok("กราฟสินค้าขายดีวาดได้", $("chart-products").querySelector("svg, .chart-empty") !== null);

section("ตารางออเดอร์");
ok("ตัวกรองเริ่มที่รออนุมัติ", $("table-orders").querySelectorAll("tbody tr").length === 3);
ok("เตือนเมื่อยอดไม่ตรงราคาจริง", $("table-orders").innerHTML.includes("price-warn"));
ok("เตือนเมื่ออ้างสินค้าที่ไม่มีอยู่", $("table-orders").innerHTML.includes("ตรวจเอง"));
ok("แสดงเครดิตคงเหลือของลูกค้า", $("table-orders").innerHTML.includes("credit-note"));
click(document.querySelector('#orders-filter [data-st="all"]'));
ok("กรอง 'ทั้งหมด' เห็นครบ 4", $("table-orders").querySelectorAll("tbody tr").length === 4);
click(document.querySelector('#orders-filter [data-st="approved"]'));
ok("กรองเฉพาะอนุมัติแล้ว", $("table-orders").querySelectorAll("tbody tr").length === 1);

section("ตารางเติมเงิน");
click(document.querySelector('#tabs [data-tab="topups"]'));
click(document.querySelector('#topups-filter [data-st="pending"]'));
const rows = $("table-topups").querySelectorAll("tbody tr");
ok("รายการที่บอทค้าง (processing) โผล่ในรออนุมัติด้วย", rows.length === 4, "ได้ " + rows.length);
ok("มีปุ่มดูสลิป (ไม่ฝังรูปในตาราง)", $("table-topups").innerHTML.includes("ดูสลิป"));
ok("ไม่มีรูป base64 ฝังในตาราง", !$("table-topups").innerHTML.includes("data:image"));
ok("มีลิงก์เปิดซองอั่งเปา", $("table-topups").innerHTML.includes("เปิดซอง") || $("table-topups").innerHTML.includes("gift.truemoney.com"));
ok("เตือนรายการที่ยังไม่มียอด", $("table-topups").innerHTML.includes("ต้องใส่ยอดเอง"));
ok("เตือนรายการที่ค้างกลางทาง", $("table-topups").innerHTML.includes("ค้างอยู่ระหว่างดำเนินการ"));
ok("แจ้งว่าไฟล์แนบผิดปกติ", $("table-topups").innerHTML.includes("แนบมาผิดปกติ") || $("table-topups").innerHTML.includes("bad"));

section("กดดูสลิป (โหลดตอนกด)");
click($("table-topups").querySelector("[data-slip]"));
await tick(6);
ok("เปิดรูปสลิปเต็มจอได้", $("img-overlay").classList.contains("open") && $("img-full").src === IMG);
await tick(6);
ok("อ่านตัวเลขในสลิปมาโชว์ให้ด้วย", $("slip-ocr").textContent.includes("500"), $("slip-ocr").textContent);
ok("มีคำเตือนว่าต้องเทียบกับแอปธนาคารก่อนอนุมัติ", $("slip-ocr").textContent.includes("ธนาคาร"));

section("อนุมัติเติมเงินที่ยังไม่มียอด — ต้องถามยอดก่อน");
globalThis.__confirm = true;
globalThis.__prompt = null;                 // ผู้ใช้กดยกเลิกตอนถามยอด
const t2btn = () => [...$("table-topups").querySelectorAll('[data-act="approve-topup"]')]
  .find(b => b.dataset.id === "t2");
click(t2btn());
await tick(6);
ok("กดยกเลิกตอนถามยอด = ไม่อนุมัติให้", store.raw("topups/t2").status === "pending");
ok("เครดิตลูกค้าไม่ขยับ", store.raw("users/c1").credit === 1000);

globalThis.__prompt = "150";
click(t2btn());
await tick(8);
ok("ใส่ยอดแล้วอนุมัติได้", store.raw("topups/t2").status === "approved");
ok("บันทึกยอดที่ใส่", store.raw("topups/t2").amount === 150);
ok("เครดิตเข้าตามยอดที่ใส่", store.raw("users/c1").credit === 1150, "ได้ " + store.raw("users/c1").credit);

globalThis.__prompt = "ไม่ใช่ตัวเลข";
store.put("topups/t5", { uid: "c2", name: "ลูกค้า สอง", email: "c2@x.com", amount: 0, method: "angpao", status: "pending", createdAt: TS(10) });
click(document.querySelector('#tabs [data-tab="topups"]'));
await tick(2);

section("อนุมัติออเดอร์");
click(document.querySelector('#tabs [data-tab="orders"]'));
click(document.querySelector('#orders-filter [data-st="pending"]'));
globalThis.__confirm = true;
const o1btn = () => [...$("table-orders").querySelectorAll('[data-act="approve-order"]')].find(b => b.dataset.id === "o1");
click(o1btn());
await tick(10);
ok("ออเดอร์ถูกอนุมัติ", store.raw("orders/o1").status === "approved");
ok("หักเครดิตลูกค้า", store.raw("users/c1").credit === 550, "ได้ " + store.raw("users/c1").credit);
ok("ส่งมอบไอดีครบ 2 ชุด", store.raw("orders/o1").items[0].delivered?.length === 2);
ok("ตัดสต๊อกเหลือ 1", store.raw("products/pA").stock === 1, "ได้ " + store.raw("products/pA").stock);

section("ของในคลังไม่พอ");
globalThis.__alerts = [];
const o2btn = () => [...$("table-orders").querySelectorAll('[data-act="approve-order"]')].find(b => b.dataset.id === "o2");
click(o2btn());
await tick(10);
ok("เตือนว่าของในคลังไม่พอ", globalThis.__alerts.some(a => a.includes("ไม่พอ")), JSON.stringify(globalThis.__alerts));
ok("ออเดอร์ยังไม่ถูกอนุมัติ", store.raw("orders/o2").status === "pending");

section("สมาชิก");
click(document.querySelector('#tabs [data-tab="members"]'));
ok("แสดงสมาชิกครบ 4 คน", $("table-members").querySelectorAll("tbody tr").length === 4);
ok("สมาชิกที่ไม่มีวันที่สมัครก็ยังโผล่", $("table-members").innerHTML.includes("สมาชิกเก่าไม่มีวันที่"));
$("member-search").value = "สอง";
$("member-search").dispatchEvent(new window.Event("input", { bubbles: true }));
ok("ค้นหาสมาชิกได้", $("table-members").querySelectorAll("tbody tr").length === 1);
$("member-search").value = "";
$("member-search").dispatchEvent(new window.Event("input", { bubbles: true }));

globalThis.__alerts = [];
click([...$("table-members").querySelectorAll('[data-act="toggle-role"]')].find(b => b.dataset.id === ADMIN_UID));
await tick(5);
ok("แอดมินถอดสิทธิ์ตัวเองไม่ได้", globalThis.__alerts.some(a => a.includes("ถอดสิทธิ์")), JSON.stringify(globalThis.__alerts));

click([...$("table-members").querySelectorAll('[data-act="toggle-role"]')].find(b => b.dataset.id === "c2"));
await tick(8);
ok("ตั้งสมาชิกคนอื่นเป็นแอดมินได้", store.raw("users/c2").role === "admin");

section("ปรับเครดิต");
click([...$("table-members").querySelectorAll('[data-act="add-credit"]')].find(b => b.dataset.id === "c1"));
await tick(3);
ok("กล่องปรับเครดิตเปิดขึ้น", $("credit-overlay").classList.contains("open"));
$("c-amount").value = "-100";
$("c-amount").dispatchEvent(new window.Event("input", { bubbles: true }));
ok("แสดงตัวอย่างก่อน→หลัง", $("c-preview").textContent.includes("→"), $("c-preview").textContent);
click($("c-save"));
await tick(10);
ok("หักเครดิตได้", store.raw("users/c1").credit === 450, "ได้ " + store.raw("users/c1").credit);
ok("มีบันทึกลงประวัติ", [...store.state.docs.values()].some(d => d.method === "admin" && d.amount === -100));

section("จัดการสินค้า");
click(document.querySelector('#tabs [data-tab="products"]'));
ok("แสดงรายการสินค้า", $("product-list").querySelectorAll(".padmin").length === 2);
click(document.querySelector('[data-act="edit-product"][data-id="pA"]'));
await tick(6);
ok("เปิดหน้าต่างแก้ไขได้", $("product-overlay").classList.contains("open"));
ok("เติมชื่อสินค้าเดิมให้", $("p-name").value === "ไอดีเกม A");
ok("ติ๊กสินค้าดิจิทัลไว้", $("p-digital").checked === true);
ok("ซ่อนช่องสต๊อกเมื่อเป็นสินค้าดิจิทัล", $("p-stock-box").classList.contains("hidden"));
ok("โหลดคลังมาแสดง", $("si-list").querySelectorAll(".si-row").length === 3, "ได้ " + $("si-list").querySelectorAll(".si-row").length);
ok("ชิ้นที่ขายแล้วแก้ไม่ได้", $("si-list").querySelector(".si-row.sold .si-login").disabled === true);
ok("นับของพร้อมขายถูกต้อง", /พร้อมขาย 0 /.test($("si-count").textContent), $("si-count").textContent);

click($("btn-add-product"));
await tick(3);
ok("เปิดหน้าต่างเพิ่มสินค้าได้", $("p-name").value === "");
ok("ยังเพิ่มชิ้นในคลังไม่ได้จนกว่าจะบันทึก", $("si-add").disabled === true);
$("p-name").value = "สินค้าใหม่";
$("p-price").value = "0";
click($("p-save"));
await tick(5);
ok("ราคา 0 บันทึกไม่ได้", $("p-msg").textContent !== "");
$("p-price").value = "250";
$("p-digital").checked = true;
$("p-digital").dispatchEvent(new window.Event("change", { bubbles: true }));
await tick(3);
click($("p-save"));
await tick(10);
const created = [...store.state.docs.entries()].find(([k, d]) => k.startsWith("products/") && d.name === "สินค้าใหม่");
ok("สร้างสินค้าดิจิทัลใหม่ได้", !!created);
ok("สินค้าดิจิทัลใหม่เริ่มที่สต๊อก 0 (ไม่ใช่ไม่จำกัด)", created?.[1].stock === 0, "ได้ " + created?.[1].stock);

section("รีเซ็ตยอดขาย");
globalThis.__confirm = true;
click(document.querySelector('#tabs [data-tab="overview"]'));
click($("btn-reset-sales"));
await tick(8);
ok("บันทึกจุดเริ่มนับใหม่", !!store.raw("settings/shop")?.salesResetAt);
ok("แสดงว่านับตั้งแต่เมื่อไหร่", $("reset-info").textContent.includes("นับยอดตั้งแต่"));
ok("มีปุ่มยกเลิกการรีเซ็ต", !$("btn-undo-reset").classList.contains("hidden"));
click($("btn-undo-reset"));
await tick(8);
ok("ยกเลิกการรีเซ็ตได้", !store.raw("settings/shop")?.salesResetAt);

section("สลับภาษาแล้วไม่พัง");
window.toggleLang();
await tick(4);
ok("ตารางเปลี่ยนเป็นอังกฤษ", $("table-members").innerHTML.includes("Member") || $("table-members").innerHTML.includes("Admin"));
window.toggleLang();
await tick(4);
ok("กลับมาไทยได้", $("kpi-sales").textContent.includes("฿"));

section("ปุ่มคัดลอกข้อมูลลูกค้า (ของเติมเกม) ต้องคัดลอกได้จริง");
{
  // เคยเป็นบั๊ก: หน้าหลังบ้านวาดปุ่มคัดลอกไว้ แต่ไม่มีตัวรับคลิกเลย กดแล้วเงียบ
  const btn = document.querySelector('#table-orders .copy[data-copy="99887766"]');
  ok("มีปุ่มคัดลอกไอดีเกมในออเดอร์", !!btn);

  if (btn) {
    let copied = null;
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async v => { copied = v; } },
    });
    click(btn);
    await tick(4);
    ok("กดแล้วคัดลอกค่าที่ถูกต้อง", copied === "99887766", String(copied));
    ok("ปุ่มบอกผลว่าคัดลอกแล้ว", btn.textContent === "✓", btn.textContent);
  }
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
