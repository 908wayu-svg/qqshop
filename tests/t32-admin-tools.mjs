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
// แถว "ไม่พบ/ยังไม่มีข้อมูล" ก็เป็น <tr> เหมือนกัน ต้องไม่นับรวมตอนเช็คว่าเจอกี่รายการ
const dataRows = id => [...rows(id)].filter(r => !r.classList.contains("empty-row"));
// เก็บข้อความที่ confirm() ถาม เพื่อตรวจว่าเตือนแรงพอกับสิ่งที่กำลังจะเกิด
let lastConfirm = "";
globalThis.confirm = (msg) => { lastConfirm = String(msg ?? ""); return globalThis.__confirm; };
window.confirm = globalThis.confirm;
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

section("บอกจำนวนที่เจอ / เตือนว่าโหลดมาแค่บางส่วน");
type("somchai@x.com");
ok("บอกจำนวนที่เจอ", $("order-search-count").textContent.includes("2"),
  $("order-search-count").textContent);
type("ไม่มีจริง");
// แอดมินที่อ่านว่า "ไม่พบ" เฉยๆ แล้วไปบอกลูกค้าว่าไม่เคยสั่ง = เรื่องใหญ่กว่าบั๊กหน้าจอ
ok("ไม่เจอ ต้องบอกว่าไม่เจอ 'ในเท่าที่โหลดมา'",
  $("order-search-count").textContent.includes("ที่โหลดมา"), $("order-search-count").textContent);
type("");
ok("เลิกค้นหาแล้วบรรทัดนับหายไป", $("order-search-count").classList.contains("hidden"));

type("ไม่มีจริง");
ok("ปุ่มล้างการค้นหาโผล่ตอนมีคำค้น", !$("order-search-clear").classList.contains("hidden"));
click($("order-search-clear"));
ok("ล้างแล้วช่องว่าง", search.value === "");
ok("ล้างแล้วกลับไปใช้ตัวกรองสถานะเดิม", rows("table-orders").length === 1);
ok("ปุ่มล้างซ่อนกลับ", $("order-search-clear").classList.contains("hidden"));

// กดตัวกรองระหว่างค้นหาแล้วไม่มีอะไรเกิดขึ้น = ดูเหมือนปุ่มเสีย ต้องเลิกค้นหาให้เลย
type("somchai@x.com");
click(document.querySelector('#orders-filter [data-st="cancelled"]'));
ok("กดตัวกรองระหว่างค้นหา = ล้างการค้นหาให้เอง", search.value === "");
ok("แล้วตัวกรองที่กดทำงานจริง", rows("table-orders").length === 1
  && $("table-orders").textContent.includes("ยกเลิก"), String(rows("table-orders").length));
click(document.querySelector('#orders-filter [data-st="pending"]'));

// =====================================================================
section("ค้นออเดอร์เก่าที่หน้านี้ยังไม่ได้โหลดมา");
// หลังบ้านโหลดแค่ 500 ใบล่าสุด ออเดอร์ที่เก่ากว่านั้นหาในหน้าไม่เจอ
// ถ้าแค่บอกว่า "ไม่พบ" แอดมินจะไปบอกลูกค้าว่าไม่เคยสั่ง ทั้งที่มีอยู่จริงในฐานข้อมูล
// จำลองด้วยการยัดออเดอร์เข้าฐานข้อมูลโดยไม่สั่งให้หน้าโหลดใหม่
const OLD_ID = "ff77ee66dd55cc44";
// เจ้าของออเดอร์เก่าใบนี้ ไม่ได้อยู่ในรายชื่อสมาชิกที่หน้านี้โหลดมา (เหมือนของจริงที่โหลดมาแค่ 500 คน)
store.put("orders/" + OLD_ID, {
  uid: "cGone", customerName: "ลูกค้าเก่า", customerEmail: "gone@x.com", total: 900,
  status: "completed", paid: true, createdAt: TS(99999),
  items: [{ id: "pA", name: "ไอดีเกม A", price: 900, qty: 1 }],
});

const OLD_SHOWN = OLD_ID.slice(0, 8).toUpperCase();
type(OLD_SHOWN);
ok("หาในหน้าไม่เจอ (ยังไม่ได้โหลดมา)", dataRows("table-orders").length === 0);
ok("มีปุ่มให้ค้นทั้งฐานข้อมูล", !$("order-search-deep").classList.contains("hidden"));

click($("order-search-deep"));
await tick(14);
ok("ค้นทั้งฐานข้อมูลแล้วเจอ", rows("table-orders").length === 1, String(rows("table-orders").length));
ok("โชว์เลขที่ที่ถูกต้อง", $("table-orders").innerHTML.includes(OLD_SHOWN));
ok("บอกว่าเจอจากในฐานข้อมูล", $("order-search-count").textContent.includes("ในฐานข้อมูล"),
  $("order-search-count").textContent);
// ถ้าโชว์ ฿0 แอดมินจะอ่านว่า "ลูกค้าไม่มีเครดิต" ทั้งที่แค่ยังไม่ได้โหลดข้อมูลคนนี้มา
ok("เครดิตของลูกค้าที่ยังไม่ได้โหลด ต้องบอกว่าไม่ทราบ ไม่ใช่โชว์ 0",
  $("table-orders").textContent.includes("ไม่ทราบ")
  && !/เครดิต: ฿?0(?!d)/.test($("table-orders").textContent),
  $("table-orders").querySelector(".credit-note")?.textContent);

// ค้นเลขที่ที่ไม่มีจริง — ต้องบอกให้ชัดว่าค้นทั้งฐานข้อมูลแล้วไม่มีจริงๆ
type("aaaa1111bbbb");
ok("เลขที่ที่ไม่มีในหน้า ก็มีปุ่มค้นให้", !$("order-search-deep").classList.contains("hidden"));
click($("order-search-deep"));
await tick(14);
ok("ค้นแล้วไม่มีจริง บอกให้ชัด", $("order-search-count").textContent.includes("ไม่มีออเดอร์เลขที่นี้จริงๆ"),
  $("order-search-count").textContent);

// ชื่อคน/อีเมล ค้นแบบนี้ไม่ได้ ต้องไม่โชว์ปุ่มให้กดเล่น
type("ไม่มีชื่อนี้");
ok("คำค้นที่ไม่ใช่เลขที่ ไม่โชว์ปุ่มค้นฐานข้อมูล", $("order-search-deep").classList.contains("hidden"));

// ค้นใหม่ให้แถวเก่ากลับมาแสดงก่อน (ก่อนหน้านี้เพิ่งลองคำค้นอื่นไป)
type(OLD_SHOWN);
click($("order-search-deep"));
await tick(14);

// กดปุ่มกับแถวที่มาจากการค้นฐานข้อมูล ต้องไม่ทำให้ตัวเลขในหน้าภาพรวมเปลี่ยน
// (ออเดอร์เก่าใบนี้ 900 บาท ถ้าหลุดเข้าไปรวมกับที่หน้าโหลดมา ยอดขาย "ทั้งหมด" จะกระโดดขึ้นเงียบๆ)
click(document.querySelector('#range-filter [data-range="all"]'));
const salesBefore = $("kpi-sales").textContent;
const hideOld = document.querySelector('#table-orders [data-act="hide-order"][data-id="' + OLD_ID + '"]');
ok("แถวที่ค้นเจอจากฐานข้อมูล กดปุ่มซ่อนได้", !!hideOld);
click(hideOld);
await tick(12);
ok("ซ่อนออเดอร์เก่าได้จริง", !!store.raw("orders/" + OLD_ID).hiddenAt);
click(document.querySelector('#range-filter [data-range="all"]'));
ok("ยอดขายในหน้าภาพรวมไม่กระโดด", $("kpi-sales").textContent === salesBefore,
  salesBefore + " -> " + $("kpi-sales").textContent);

// เปลี่ยนคำค้นแล้ว ผลค้นลึกของคำเดิมต้องไม่ค้างอยู่ — และต้องค้นซ้ำได้
type(OLD_SHOWN);
ok("กลับมาค้นเลขเดิม ผลเก่าไม่ค้าง", dataRows("table-orders").length === 0);
ok("และยังกดค้นฐานข้อมูลซ้ำได้ (ไม่ใช่ปุ่มหายไปเฉยๆ)",
  !$("order-search-deep").classList.contains("hidden"));
click($("order-search-deep"));
await tick(14);
ok("ค้นซ้ำแล้วเจอเหมือนเดิม", dataRows("table-orders").length === 1);
type("");
click(document.querySelector('#orders-filter [data-st="pending"]'));

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

// ---------- ประวัติต้องครบ ไม่ใช่แค่เท่าที่หน้าโหลดมา ----------
// ลูกค้าเก่าที่ออเดอร์ไม่ได้อยู่ใน 500 รายการล่าสุด ต้องยังเห็นในประวัติของตัวเอง
// ไม่งั้นแอดมินจะสรุปว่า "ลูกค้าคนนี้ซื้อน้อย" ทั้งที่ซื้อไปเยอะ
window.closePanel("member-overlay");
store.put("orders/aa11bb22cc33dd44", {
  uid: "c1", customerName: "สมชาย ใจดี", customerEmail: "somchai@x.com", total: 1500,
  status: "completed", paid: true, createdAt: TS(88888),
  items: [{ id: "pA", name: "ไอดีเกม A", price: 1500, qty: 1 }],
});
click(btnFor("c1"));
await tick(14);
ok("เห็นออเดอร์เก่าที่หน้ายังไม่ได้โหลดมาด้วย",
  $("mh-orders").textContent.includes("1,500"), $("mh-orders").textContent.slice(0, 90));
ok("ยอดซื้อสำเร็จรวมของเก่าเข้าไปด้วย", $("mh-spent").textContent.includes("1,800"),
  $("mh-spent").textContent);
ok("ไม่มีคำเตือนว่าโหลดไม่ครบ", !$("mh-msg").classList.contains("show"), $("mh-msg").textContent);

// ---------- ฐานข้อมูลตอบไม่ได้ ต้องเตือน ไม่ใช่โชว์ตัวเลขต่ำๆ เฉยๆ ----------
window.closePanel("member-overlay");
store.state.failReads = true;
click(btnFor("c1"));
await tick(14);
store.state.failReads = false;
ok("โหลดไม่สำเร็จแล้วเตือนว่าตัวเลขอาจไม่ครบ", $("mh-msg").classList.contains("show")
  && $("mh-msg").textContent.includes("อาจต่ำกว่าความจริง"), $("mh-msg").textContent);
ok("ยังโชว์เท่าที่มีให้ดูได้ ไม่ใช่กล่องว่าง", $("mh-orders").textContent.trim().length > 0);

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
// ออเดอร์ใบนี้ส่งไอดี/รหัสผ่านให้ลูกค้าไปแล้ว ซ่อนไป = ลูกค้าเปิดดูของที่ซื้อไม่ได้อีก
ok("เตือนแรงเป็นพิเศษเมื่อออเดอร์มีรหัสที่ลูกค้าซื้อไปแล้ว",
  lastConfirm.includes("เปิดดูรหัสของตัวเองไม่ได้อีก"), lastConfirm.slice(0, 60));
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
click(document.querySelector('#topups-filter [data-st="all"]'));
const hideTopup = document.querySelector('#table-topups [data-act="hide-topup"][data-id="tp111"]');
ok("มีปุ่มซ่อนในแถวเติมเงินที่อนุมัติแล้ว", !!hideTopup);
click(hideTopup);
await tick(10);
// เติมเงินที่อนุมัติแล้ว = เครดิตเข้ากระเป๋าไปแล้ว รายการนี้คือที่มาชิ้นเดียวที่ลูกค้ามี
ok("เตือนว่ารายการนี้อธิบายที่มาของเครดิต", lastConfirm.includes("หาที่มาไม่เจอ"),
  lastConfirm.slice(0, 60));
ok("ซ่อนรายการเติมเงินได้", !!store.raw("topups/tp111").hiddenAt);
ok("ยอดเงินของรายการเติมไม่ถูกแตะ", store.raw("topups/tp111").amount === 500);

// ---------- กดยกเลิกตอนถามยืนยัน ต้องไม่เกิดอะไรขึ้น ----------
globalThis.__confirm = false;
calls.length = 0;
click(document.querySelector('#table-topups [data-act="unhide-topup"][data-id="tp111"]'));
await tick(6);
ok("กดยกเลิกตอนยืนยัน = ไม่ยิงเซิร์ฟเวอร์", !calls.some(c => c.path === "/admin/topup/hide"));
ok("ค่ายังเป็นซ่อนอยู่เหมือนเดิม", !!store.raw("topups/tp111").hiddenAt);
globalThis.__confirm = true;

// =====================================================================
section("ห้ามซ่อนรายการที่ลูกค้ายังรออยู่");
// ลูกค้าต้องเห็นออเดอร์/คำขอเติมเงินที่ยังไม่จบของตัวเองเสมอ
// (ออเดอร์ pending ยังเป็นช่วงที่ลูกค้าแก้ไอดีเกมได้ด้วย ซ่อนไปแล้วจะแก้ไม่ได้เลย)
ok("รายการเติมเงินที่ยังรออนุมัติ ไม่มีปุ่มซ่อน",
  !document.querySelector('#table-topups [data-act="hide-topup"][data-id="tp222"]'));

click(document.querySelector('#tabs [data-tab="orders"]'));
click(document.querySelector('#orders-filter [data-st="all"]'));
ok("ออเดอร์ที่ยังรอดำเนินการ ไม่มีปุ่มซ่อน",
  !document.querySelector('#table-orders [data-act="hide-order"][data-id="zz9988776655"]'));
ok("ออเดอร์ที่ยกเลิกแล้ว ยังซ่อนได้",
  !!document.querySelector('#table-orders [data-act="hide-order"][data-id="old111222333"]'));
// ใบที่ไม่มีรหัสส่งมอบ ใช้คำถามธรรมดา ไม่ต้องขู่เกินจำเป็น
globalThis.__confirm = false;
click(document.querySelector('#table-orders [data-act="hide-order"][data-id="old111222333"]'));
await tick(4);
// ออเดอร์ที่ยกเลิกแล้ว เครดิตถูกคืนไปแล้ว จึงไม่ต้องเตือนเรื่องเงินหาย ใช้คำถามธรรมดา
ok("ออเดอร์ที่ยกเลิกแล้ว ใช้คำถามธรรมดา",
  !lastConfirm.includes("เปิดดูรหัสของตัวเองไม่ได้อีก")
  && !lastConfirm.includes("หาที่มาไม่เจอ")
  && lastConfirm.includes("ซ่อนรายการนี้"),
  lastConfirm.slice(0, 50));
globalThis.__confirm = true;

// เซิร์ฟเวอร์ต้องกันอีกชั้น ไม่ใช่พึ่งแค่หน้าเว็บไม่วาดปุ่ม
let openErr = "";
try { await QQ.setOrderHidden("zz9988776655", true); } catch (e) { openErr = e.adminCode || ""; }
ok("เซิร์ฟเวอร์ปฏิเสธการซ่อนออเดอร์ที่ยังไม่จบ", openErr === "STILL_OPEN", openErr);
ok("ออเดอร์นั้นไม่ถูกซ่อนจริง", !store.raw("orders/zz9988776655").hiddenAt);

let openErr2 = "";
try { await QQ.setTopupHidden("tp222", true); } catch (e) { openErr2 = e.adminCode || ""; }
ok("เซิร์ฟเวอร์ปฏิเสธการซ่อนคำขอเติมเงินที่ยังรออยู่", openErr2 === "STILL_OPEN", openErr2);

// เลิกซ่อนต้องทำได้เสมอ ไม่ว่าสถานะไหน (กันติดกับดักซ่อนแล้วเอาคืนไม่ได้)
await QQ.setTopupHidden("tp111", false);
ok("เลิกซ่อนได้ตามปกติ", store.raw("topups/tp111").hiddenAt === null);

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

// ---------- บันทึกที่มากเกินกว่าจะดึงมาได้ครั้งเดียว ----------
// ช่องค้นด้านล่างกรองได้เฉพาะในก้อนที่ดึงมาแล้ว ถ้าไม่บอกว่าดึงมาไม่ครบ
// แอดมินจะค้นเรื่องเก่าไม่เจอแล้วสรุปว่า "ไม่มีบันทึก" ทั้งที่มี
ok("บันทึกยังไม่ถึงเพดาน = ไม่มีคำเตือน", !$("logs-cap").classList.contains("show"),
  $("logs-cap").textContent);

for (let n = 0; n < 300; n++) {
  store.put("adminLogs/bulk" + String(n).padStart(4, "0"), {
    at: TS(5000 + n), action: "credit.adjust", byUid: "x", byEmail: "someone@x.com",
    targetUid: "c1", amount: 1, before: 0, after: 1,
  });
}
click($("btn-reload-logs"));
await tick(14);
ok("บันทึกชนเพดานแล้วเตือน", $("logs-cap").classList.contains("show"), $("logs-cap").textContent);
ok("คำเตือนบอกจำนวนที่ดึงมาได้", $("logs-cap").textContent.includes("300"), $("logs-cap").textContent);
ok("คำเตือนบอกด้วยว่าการค้นครอบคลุมแค่ก้อนนี้", $("logs-cap").textContent.includes("ค้น"),
  $("logs-cap").textContent);

for (let n = 0; n < 300; n++) store.state.docs.delete("adminLogs/bulk" + String(n).padStart(4, "0"));
click($("btn-reload-logs"));
await tick(14);
ok("ลบของทดสอบแล้วคำเตือนหายไป", !$("logs-cap").classList.contains("show"),
  $("logs-cap").textContent);

// ---------- ค้นในบันทึก ----------
const logSearch = $("log-search");
const typeLog = v => { logSearch.value = v; logSearch.dispatchEvent(new window.Event("input", { bubbles: true })); };
const logRows = () => [...rows("table-logs")].filter(r => !r.classList.contains("empty-row"));

const allLogs = logRows().length;
typeLog("สมชาย");
ok("ค้นในบันทึกด้วยชื่อลูกค้าได้", logRows().length > 0 && logRows().length < allLogs,
  logRows().length + " / " + allLogs);
ok("บอกว่าแสดงกี่จากทั้งหมด", $("log-count").textContent.includes(String(allLogs)),
  $("log-count").textContent);
ok("ทุกแถวที่เหลือเกี่ยวกับคนที่ค้น", logRows().every(r => r.textContent.includes("สมชาย")));

typeLog("ปรับเครดิต");
ok("ค้นด้วยชื่อการกระทำได้", logRows().length > 0
  && logRows().every(r => r.textContent.includes("ปรับเครดิต")), String(logRows().length));

typeLog("ไม่มีคำนี้แน่นอน");
ok("ไม่เจอ บอกว่าไม่พบ", $("table-logs").textContent.includes("ไม่พบ"), $("table-logs").textContent.trim());

typeLog("");
ok("ล้างคำค้นแล้วกลับมาครบ", logRows().length === allLogs, logRows().length + " / " + allLogs);
ok("ล้างแล้วไม่โชว์ตัวนับ", $("log-count").textContent === "");

// ---------- บันทึกต้องอ่านรู้เรื่องแม้สมาชิกถูกลบไปแล้ว ----------
// ปรับเครดิตให้คนที่ไม่ได้อยู่ในรายชื่อที่หน้านี้โหลดมา แล้วดูว่าบันทึกโชว์อะไร
store.put("users/cGhost", { uid: "cGhost", email: "ghost@x.com", name: "ผี", role: "member", credit: 10 });
await QQ.setRole("cGhost", "admin");        // บันทึก role.grant มีทั้ง targetUid และ targetEmail
store.state.docs.delete("users/cGhost");    // แล้วสมาชิกคนนั้นถูกลบทิ้ง
click($("btn-reload-logs"));
await tick(14);
typeLog("ghost@x.com");
ok("สมาชิกที่ถูกลบแล้ว บันทึกยังบอกได้ว่าเป็นใคร (ใช้อีเมลที่บันทึกไว้)",
  logRows().length > 0, $("table-logs").textContent.slice(0, 80));
ok("ไม่โชว์เป็นรหัสดิบเฉยๆ", !logRows()[0]?.textContent.includes("cGhost"),
  logRows()[0]?.textContent);
typeLog("");

// =====================================================================
section("เตือนเมื่อข้อมูลมากเกินกว่าที่หน้านี้โหลดได้");
// ยอดขาย ยอดสมาชิก และเครดิตคงเหลือรวม คิดจากเท่าที่หน้าดึงมาได้เท่านั้น
// พอร้านโตเกินเพดาน ตัวเลขจะต่ำกว่าความจริงเงียบๆ ทั้งที่หน้าตายังดูปกติ
ok("ข้อมูลยังไม่ถึงเพดาน = ไม่มีคำเตือน", !$("cap-warning").classList.contains("show"),
  $("cap-warning").textContent);

// ยัดออเดอร์ให้ชนเพดาน 500 พอดี
for (let n = 0; n < 500; n++) {
  store.put("orders/bulk" + String(n).padStart(4, "0"), {
    uid: "c1", customerName: "สมชาย ใจดี", customerEmail: "somchai@x.com", total: 1,
    status: "completed", paid: true, createdAt: TS(1000 + n),
    items: [{ id: "pA", name: "ไอดีเกม A", price: 1, qty: 1 }],
  });
}
await reload();
ok("ชนเพดานแล้วต้องขึ้นคำเตือน", $("cap-warning").classList.contains("show"),
  $("cap-warning").textContent);
ok("คำเตือนบอกว่าคือข้อมูลประเภทไหน", $("cap-warning").textContent.includes("ออเดอร์"),
  $("cap-warning").textContent);
ok("คำเตือนบอกตัวเลขเพดาน", $("cap-warning").textContent.includes("500"),
  $("cap-warning").textContent);
ok("ไม่เตือนประเภทที่ยังไม่ชนเพดาน", !$("cap-warning").textContent.includes("สมาชิก"),
  $("cap-warning").textContent);

// เก็บกวาดให้เทสข้ออื่นทำงานต่อได้เหมือนเดิม
for (let n = 0; n < 500; n++) store.state.docs.delete("orders/bulk" + String(n).padStart(4, "0"));
await reload();
ok("ลบของทดสอบแล้วคำเตือนหายไป", !$("cap-warning").classList.contains("show"));

// =====================================================================
section("หน้าเว็บต้องวาดปุ่มให้ตรงกับสถานะ (กฎเหล็กข้อ 16 + 17)");
// เซิร์ฟเวอร์กันการกดผิดชุด/ข้ามขั้นไว้อยู่แล้ว แต่หน้าเว็บต้องไม่วาดปุ่มผิดตั้งแต่แรก
// ไม่งั้นแอดมินกดแล้วเด้ง error รัวๆ โดยไม่รู้ว่าตัวเองทำอะไรผิด
// และที่อันตรายที่สุดคือ "อนุมัติ" (ปุ่มของออเดอร์เก่า) ไปโผล่ในออเดอร์ใหม่ = หักเครดิตซ้ำสองรอบ
{
  // ล้างของเดิมออกให้เหลือเฉพาะที่จะทดสอบ
  for (const k of [...store.state.docs.keys()].filter(k => k.startsWith("orders/"))) {
    store.state.docs.delete(k);
  }
  const mk = (id, extra) => store.put("orders/" + id, {
    uid: "c1", customerName: "สมชาย ใจดี", customerEmail: "somchai@x.com", total: 100,
    createdAt: TS(10), items: [{ id: "pA", name: "ไอดีเกม A", price: 100, qty: 1 }], ...extra,
  });
  mk("nPend", { paid: true, status: "pending" });
  mk("nProc", { paid: true, status: "processing" });
  mk("nDone", { paid: true, status: "completed" });
  mk("nVoid", { paid: true, status: "cancelled" });
  mk("oldPend", { status: "pending" });          // ออเดอร์เก่า ไม่มี paid
  mk("oldDone", { status: "approved" });
  await reload();
  click(document.querySelector('#tabs [data-tab="orders"]'));
  click(document.querySelector('#orders-filter [data-st="all"]'));

  const actsOf = id => [...document.querySelectorAll('#table-orders [data-act][data-id="' + id + '"]')]
    .map(b => b.dataset.act).sort();
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  ok("ออเดอร์ใหม่ · รอดำเนินการ = เริ่มดำเนินการ + ยกเลิก",
    same(actsOf("nPend"), ["cancel-order", "start-order"]), actsOf("nPend").join(","));
  ok("ออเดอร์ใหม่ · กำลังดำเนินการ = ทำเสร็จแล้ว + ยกเลิก",
    same(actsOf("nProc"), ["cancel-order", "complete-order"]), actsOf("nProc").join(","));
  ok("ออเดอร์ใหม่ · สำเร็จ = ยกเลิกคืนเครดิต + ซ่อน",
    same(actsOf("nDone"), ["cancel-order", "hide-order"]), actsOf("nDone").join(","));
  ok("ออเดอร์ใหม่ · ยกเลิกแล้ว = เหลือแค่ซ่อน",
    same(actsOf("nVoid"), ["hide-order"]), actsOf("nVoid").join(","));

  ok("ออเดอร์เก่า · รอดำเนินการ = อนุมัติ + ไม่อนุมัติ (ปุ่มคนละชุด)",
    same(actsOf("oldPend"), ["approve-order", "reject-order"]), actsOf("oldPend").join(","));
  ok("ออเดอร์เก่า · อนุมัติแล้ว = เหลือแค่ซ่อน",
    same(actsOf("oldDone"), ["hide-order"]), actsOf("oldDone").join(","));

  // ข้อที่อันตรายที่สุด — ห้ามสลับปุ่มกันเด็ดขาด
  const newOnes = ["nPend", "nProc", "nDone", "nVoid"];
  ok("ไม่มีปุ่ม 'อนุมัติ/ไม่อนุมัติ' โผล่ในออเดอร์ใหม่เลย (กันหักเครดิตซ้ำ)",
    newOnes.every(id => !actsOf(id).some(a => a === "approve-order" || a === "reject-order")),
    newOnes.map(id => id + ":" + actsOf(id).join("|")).join(" · "));
  ok("ไม่มีปุ่มชุดใหม่โผล่ในออเดอร์เก่า",
    !actsOf("oldPend").some(a => ["start-order", "complete-order", "cancel-order"].includes(a)),
    actsOf("oldPend").join(","));

  // กฎ 17 ฝั่งหน้าเว็บ: ปุ่ม "ทำเสร็จแล้ว" ต้องไม่โผล่ตอนยังรอดำเนินการ
  ok("ปุ่ม 'ทำเสร็จแล้ว' ไม่โผล่ตอนยังรอดำเนินการ",
    !actsOf("nPend").includes("complete-order"), actsOf("nPend").join(","));
  ok("ปุ่ม 'เริ่มดำเนินการ' ไม่โผล่ตอนกำลังดำเนินการอยู่แล้ว",
    !actsOf("nProc").includes("start-order"), actsOf("nProc").join(","));
}

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

// =====================================================================
section("การแบ่งวันในกราฟต้องใช้เวลาท้องถิ่น ไม่ใช่ UTC");
// กฎเหล็กข้อ 8 — เคยพลาดมาแล้วจริง: ออเดอร์ตอนเช้าหายไปจากกราฟ
// ไทยเป็น UTC+7 ถ้าแบ่งวันด้วยเวลา UTC ออเดอร์ที่สั่งก่อน 07:00 น. ตามเวลาไทย
// จะถูกนับเป็น "เมื่อวาน" — ยอดขายรายวันเลื่อนไปทั้งแถบโดยไม่มีใครทันสังเกต
// (เดิมไม่มีเทสคุมเรื่องนี้เลย ทั้งที่เขียนไว้เป็นกฎเหล็ก)
{
  const atLocal = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0);

  // เที่ยงคืนครึ่ง กับ ก่อนเที่ยงคืนครึ่ง = คนละวันเสมอ ไม่ว่าเครื่องอยู่โซนเวลาไหน
  ok("00:30 ของวันหนึ่ง ถูกนับเป็นวันนั้น",
    ADMIN.dayKey(atLocal(2026, 9, 6, 0, 30)) === "2026-09-06",
    ADMIN.dayKey(atLocal(2026, 9, 6, 0, 30)));
  ok("23:30 ของวันก่อนหน้า ถูกนับเป็นวันก่อนหน้า",
    ADMIN.dayKey(atLocal(2026, 9, 5, 23, 30)) === "2026-09-05",
    ADMIN.dayKey(atLocal(2026, 9, 5, 23, 30)));
  ok("06:00 เช้า (ช่วงที่เคยหายไปตอนใช้ UTC) ยังอยู่วันเดียวกัน",
    ADMIN.dayKey(atLocal(2026, 9, 6, 6, 0)) === "2026-09-06",
    ADMIN.dayKey(atLocal(2026, 9, 6, 6, 0)));

  // เทียบกับวิธีที่ผิด (แปลงเป็น UTC ก่อนตัดวัน) — ต้องให้ผลต่างกันในโซนเวลาไทย
  // ถ้าเครื่องที่รันเทสตั้งเป็น UTC พอดี สองวิธีจะได้ผลเท่ากัน ข้อนี้จึงข้ามไป
  const offset = -new Date().getTimezoneOffset();   // นาที (ไทย = +420)
  if (offset > 0) {
    const early = atLocal(2026, 9, 6, 0, 30);
    const utcWay = early.toISOString().slice(0, 10);
    ok("วิธีที่ผิด (ตัดวันจากเวลา UTC) ให้ผลคนละวันจริง — เทสนี้มีความหมาย",
      utcWay !== ADMIN.dayKey(early), "UTC ได้ " + utcWay);
  } else {
    ok("เครื่องที่รันอยู่โซนเวลา UTC จึงข้ามการเทียบ (ไม่ใช่ความผิดพลาด)", true);
  }

  // ผ่านของจริง: ออเดอร์ตอนตี 1 ของวันนี้ ต้องอยู่ในถังของวันนี้
  const today = new Date(); today.setHours(1, 0, 0, 0);
  const series = ADMIN.dailySeries([{ _date: today }], () => 1);
  const todayKey = ADMIN.dayKey(new Date());
  const bucket = series.find(x => x.key === todayKey);
  ok("ออเดอร์ตอนตี 1 ของวันนี้ ตกอยู่ในถังของวันนี้", bucket?.value === 1,
    JSON.stringify(series.slice(-2)));
  ok("ไม่มีถังไหนได้ค่าเกินมา", series.reduce((a, x) => a + x.value, 0) === 1,
    String(series.reduce((a, x) => a + x.value, 0)));
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
process.exitCode = fail ? 1 : 0;
