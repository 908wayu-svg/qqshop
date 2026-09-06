// ===== หน้าเว็บเวอร์ชันเก่าในแคช เจอสคริปต์เวอร์ชันใหม่ =====
// ไฟล์ .html กับ .js ถูกแคชแยกกัน และ GitHub Pages เก็บไว้ราว 10 นาที
// ช่วงนั้นคนที่เคยเปิดเว็บไว้แล้วจะได้ "หน้าเก่า + สคริปต์ใหม่" มาเจอกัน
//
// สคริปต์ใหม่ที่ไปหา element ซึ่งยังไม่มีในหน้าเก่า จะพังตั้งแต่บรรทัดแรกที่เรียกใช้
// ผลไม่ใช่แค่ "ปุ่มใหม่ยังไม่มา" แต่คือ **ทั้งหน้าว่างเปล่า** เพราะโมดูลหยุดกลางคัน
// เทสนี้จำลองสถานการณ์นั้นตรงๆ: ลบของใหม่ออกจาก HTML แล้วดูว่าหน้ายังใช้งานได้ไหม
import { buildSandbox, makeDom, loadI18n, tick, makeAdmin } from "./harness.mjs";
import { installAdminServer } from "./fake/admin-server.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const TS = n => new fs2.Timestamp(Date.now() - n * 1000);

// ของที่เพิ่มเข้ามาในรอบนี้ — หน้าเวอร์ชันก่อนหน้ายังไม่มีสิ่งเหล่านี้
const NEW_IDS = [
  "order-search", "order-search-clear", "order-search-count", "order-search-deep",
  "log-search", "log-count", "cap-warning", "logs-cap", "mh-msg",
  "member-overlay", "page-logs", "btn-reload-logs", "table-logs", "history-note",
];

// ลบ element ที่มี id เหล่านี้ออกจาก HTML (แบบหยาบๆ พอให้เหมือนหน้าเก่า)
function stripNew(html) {
  let out = html;
  for (const id of NEW_IDS) {
    // แท็กเดี่ยว เช่น <input id="x" ...>
    out = out.replace(new RegExp('<(input|button|p|span|div|table|section|label)\\b[^>]*id="' + id + '"[^>]*>', "g"), "");
  }
  // ก้อนใหญ่ที่มี id เหล่านี้อยู่ข้างใน ตัดทิ้งทั้งก้อน
  out = out.replace(/<div class="overlay" id="member-overlay">[\s\S]*?<\/div>\s*<\/div>/, "");
  out = out.replace(/<section class="tab-page hidden" id="page-logs">[\s\S]*?<\/section>/, "");
  out = out.replace(/<button class="tab" data-tab="logs"[^>]*>[\s\S]*?<\/button>/, "");
  return out;
}

buildSandbox();
const dom = makeDom("admin.html", stripNew);
loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

section("ยืนยันว่าจำลองหน้าเก่าได้จริง");
ok("ช่องค้นหาออเดอร์ไม่มีอยู่ในหน้าเก่า", !$("order-search"));
ok("แท็บบันทึกไม่มีอยู่ในหน้าเก่า", !$("page-logs"));
ok("กล่องประวัติสมาชิกไม่มีอยู่ในหน้าเก่า", !$("member-overlay"));
ok("ของเดิมยังอยู่ครบ (ตารางออเดอร์)", !!$("table-orders"));

await QQ.registerWithEmail("908wayu@gmail.com", "adminpass", "เจ้าของร้าน", "");
installAdminServer();
await makeAdmin(QQ, store);
await tick(6);

store.put("users/c1", { uid: "c1", email: "c1@x.com", name: "ลูกค้า หนึ่ง", role: "member", credit: 100, createdAt: TS(500) });
store.put("products/pA", { name: "ไอดีเกม A", price: 300, stock: 2, active: true });
store.put("orders/o1", {
  uid: "c1", customerName: "ลูกค้า หนึ่ง", customerEmail: "c1@x.com", total: 300,
  status: "pending", paid: true, createdAt: TS(100),
  items: [{ id: "pA", name: "ไอดีเกม A", price: 300, qty: 1 }],
});
store.put("topups/t1", { uid: "c1", name: "ลูกค้า หนึ่ง", email: "c1@x.com", amount: 50,
  method: "bank", hasSlip: true, status: "pending", createdAt: TS(50) });

let crashed = null;
try {
  await import("./sandbox/admin.mjs");
} catch (e) {
  crashed = e.message;
}
await tick(16);

section("สคริปต์ใหม่ต้องไม่ทำให้หน้าเก่าพังทั้งหน้า");
ok("โมดูลโหลดจนจบ ไม่พังกลางคัน", crashed === null, String(crashed));
ok("แดชบอร์ดยังเปิดให้แอดมิน", !$("dash").classList.contains("hidden"));
ok("ไม่มีหน้ากั้นค้าง", $("gate").classList.contains("hidden"));

section("งานเดิมยังทำได้ครบ");
ok("ตารางออเดอร์ยังวาดได้", $("table-orders").querySelectorAll("tbody tr").length > 0,
  $("table-orders").innerHTML.slice(0, 60));
ok("ตารางเติมเงินยังวาดได้", $("table-topups").querySelectorAll("tbody tr").length > 0);
ok("ตารางสมาชิกยังวาดได้", $("table-members").querySelectorAll("tbody tr").length > 0);
ok("การ์ดตัวเลขยังคำนวณได้", $("kpi-members").textContent !== "—", $("kpi-members").textContent);
ok("ยังมีปุ่มทำงานกับออเดอร์ให้กด",
  !!document.querySelector('#table-orders [data-act]'),
  $("table-orders").innerHTML.slice(0, 80));

// สลับแท็บ (ตัวจัดการแท็บวิ่งผ่านโค้ดใหม่ที่เรียก loadLogs ด้วย)
document.querySelector('#tabs [data-tab="members"]')
  .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await tick(6);
ok("สลับแท็บได้ตามปกติ", !$("page-members").classList.contains("hidden"));

// =====================================================================
// หน้าของลูกค้าก็เจอเรื่องเดียวกัน — และเจ็บกว่า เพราะเป็นหน้าที่ลูกค้าใช้จริง
// (หน้าหลังบ้านมีแค่เจ้าของร้านเปิด แต่หน้าประวัติ/เติมเงินมีลูกค้าทุกคน)
section("หน้าประวัติการซื้อเวอร์ชันเก่า เจอสคริปต์ใหม่");
{
  const stripP = html => html.replace(/<p class="hint hidden" id="history-note"><\/p>\s*/, "");
  buildSandbox();
  makeDom("purchases.html", stripP);
  loadI18n();
  const mod = await import("./sandbox/auth.mjs?p=1").catch(() => null);
  ok("จำลองหน้าเก่าได้ (ไม่มีที่บอกเรื่องประวัติไม่ครบ)", !document.getElementById("history-note"));

  // ตรวจที่โค้ดโดยตรง: ทุกที่ที่ไปหา element ใหม่ ต้องเช็คก่อนใช้
  const src = (await import("fs")).readFileSync("../purchases.js", "utf8");
  const block = src.slice(src.indexOf('getElementById("history-note")'));
  ok("purchases.js เช็คก่อนใช้ history-note", /if \(note\)/.test(block.slice(0, 200)),
    block.slice(0, 120));

  const wsrc = (await import("fs")).readFileSync("../wallet.js", "utf8");
  const wblock = wsrc.slice(wsrc.indexOf('getElementById("topup-note")'));
  ok("wallet.js เช็คก่อนใช้ topup-note", /if \(note\)/.test(wblock.slice(0, 200)),
    wblock.slice(0, 120));
}

section("ไล่ทุกไฟล์: element ที่เพิ่มใหม่ต้องไม่ถูกเรียกใช้แบบไม่เช็คก่อน");
{
  const fsx = await import("fs");
  const NEW = ["history-note", "topup-note", "order-search", "order-search-clear",
    "order-search-count", "order-search-deep", "log-search", "log-count",
    "cap-warning", "logs-cap", "mh-msg", "member-overlay", "btn-reload-logs"];
  const bad = [];
  for (const f of ["admin.js", "purchases.js", "wallet.js"]) {
    const code = fsx.readFileSync("../" + f, "utf8");
    for (const id of NEW) {
      // รูปแบบที่อันตราย: getElementById("x").อะไรสักอย่าง  (ไม่มี ?. คั่น)
      const re = new RegExp('getElementById\\("' + id + '"\\)\\s*\\.', "g");
      if (re.test(code)) bad.push(f + ": " + id);
    }
  }
  ok("ไม่มีที่ไหนเรียกใช้ element ใหม่แบบไม่เช็คก่อน", bad.length === 0, bad.join(", "));
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
