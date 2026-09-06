// ===== ทดสอบการแสดงผลบนจอมือถือ =====
// jsdom ไม่คำนวณ layout จริง จึงตรวจ 2 อย่างที่ตรวจได้แน่นอน:
//   1. ทุกช่องในตารางต้องมี data-label (มือถือเอาไปโชว์เป็นชื่อคอลัมน์หน้าค่า)
//   2. กฎ CSS ในบล็อกจอมือถือยังอยู่ครบ (เคยแก้ทีนึงแล้วหลุดหายไปเงียบๆ)
import { buildSandbox, makeDom, loadI18n, tick, makeAdmin } from "./harness.mjs";
import { installAdminServer } from "./fake/admin-server.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";
import fs from "fs";
import path from "path";
import { SRC } from "./harness.mjs";

const css = fs.readFileSync(path.join(SRC, "style.css"), "utf8");
const mobile = css.slice(css.indexOf("@media(max-width:600px)")).replace(/\s*\n\s*/g, " ");
const TS = n => new fs2.Timestamp(Date.now() - n * 1000);

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const has = re => re.test(mobile);
const flatCss = css.replace(/\s*\n\s*/g, " ");

buildSandbox(); makeDom("admin.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

await QQ.registerWithEmail("908wayu@gmail.com", "adminpass", "เจ้าของร้าน", "");
installAdminServer();
await makeAdmin(QQ, store);
await tick(6);

store.put("users/c1", { uid: "c1", email: "c1@x.com", name: "ลูกค้า หนึ่ง", role: "member", credit: 500, createdAt: TS(300), provider: "google" });
store.put("products/pA", { name: "ไอดีเกม A", price: 300, stock: 3, active: true, category: "game_id" });
store.put("orders/o1", { uid: "c1", customerName: "ลูกค้า หนึ่ง", customerEmail: "c1@x.com", total: 300,
  status: "pending", createdAt: TS(100), items: [{ id: "pA", name: "ไอดีเกม A", price: 300, qty: 1 }] });
store.put("topups/t1", { uid: "c1", name: "ลูกค้า หนึ่ง", email: "c1@x.com", amount: 500, method: "bank",
  hasSlip: true, status: "pending", createdAt: TS(50) });
store.put("topupSlips/t1", { uid: "c1", slip: "data:image/jpeg;base64," + "A".repeat(80) + "==" });

await import("./sandbox/admin.mjs");
await tick(14);

section("ทุกช่องในตารางหลังบ้านต้องมีชื่อคอลัมน์กำกับ (data-label)");
for (const [name, id] of [["ออเดอร์", "table-orders"], ["เติมเงิน", "table-topups"], ["สมาชิก", "table-members"]]) {
  const rows = [...document.querySelectorAll(`#${id} tbody tr`)];
  ok(`ตาราง${name} มีแถวข้อมูลให้ตรวจ`, rows.length > 0, "ได้ " + rows.length + " แถว");
  const cells = rows.flatMap(r => [...r.querySelectorAll("td")]);
  // ช่องปุ่มกดไม่ต้องมีป้าย (ปุ่มบอกตัวเองอยู่แล้ว)
  const needLabel = cells.filter(td => !td.classList.contains("actions") && !td.classList.contains("empty"));
  const missing = needLabel.filter(td => !td.getAttribute("data-label"));
  ok(`ตาราง${name} ทุกช่องมี data-label`, missing.length === 0,
    missing.map(td => td.textContent.trim().slice(0, 20)).join(" | "));
  // ป้ายต้องเป็นคำแปล ไม่ใช่รหัส key ดิบๆ
  const rawKeys = needLabel.filter(td => /^[a-z_]+$/.test(td.getAttribute("data-label") || ""));
  ok(`ตาราง${name} ป้ายถูกแปลแล้ว ไม่ใช่ชื่อ key`, rawKeys.length === 0,
    rawKeys.map(td => td.getAttribute("data-label")).join(","));
}

section("กฎ CSS สำหรับจอมือถือยังอยู่ครบ");
ok("ตารางแปลงเป็นการ์ด (ซ่อนหัวตาราง)", has(/\.table-wrap thead\{[^}]*display:none/));
ok("ช่องตารางเรียงเป็นบรรทัด", has(/\.table-wrap[^{]*td\{[^}]*display:block/));
ok("เอา data-label มาโชว์เป็นป้าย", has(/\.table-wrap td::before\{[^}]*content:attr\(data-label\)/));
ok("ป้ายลอยซ้าย (ไม่ใช้ flex เพราะ <br> จะแตกคอลัมน์)", has(/\.table-wrap td::before\{[^}]*float:left/));
ok("ตารางไม่ต้องเลื่อนแนวนอนแล้ว", has(/\.table-wrap\{[^}]*overflow-x:visible/));
ok("แถบแท็บหมวดหมู่เฟดขอบขวาบอกว่าเลื่อนต่อได้", has(/\.cat-tabs\{[^}]*mask-image/));
ok("แถบแท็บหลังบ้านเฟดขอบขวาด้วย", has(/\.tabs-main\{[^}]*mask-image/));
ok("แถบตัวกรองสถานะเฟดขอบขวาบอกว่าเลื่อนต่อได้", has(/\.range-filter\{[^}]*mask-image/));
ok("การ์ดตัวเลขหลังบ้านย่อลงให้ได้ 2 ใบต่อแถว", has(/\.tiles\{[^}]*minmax\(150px/));
ok("ปุ่มติดต่อย่อเป็นวงกลม", has(/\.contact-fab\{[^}]*border-radius:50%/));
ok("เว้นที่ท้ายหน้าให้ปุ่มลอย", has(/has-contact-fab[^{]*\{[^}]*padding-bottom/));
ok("สินค้าหน้าร้านเหลือ 2 คอลัมน์", has(/\.grid\{[^}]*minmax\(150px/));
ok("ช่วงราคาลงมาเต็มบรรทัด", has(/\.price-range\{[^}]*flex:1 1 100%/));
ok("ช่องราคายืดหดได้ ไม่ดันจอ 320px", has(/\.price-range input\[type=number\]\{[^}]*min-width:0/));
ok("ตัวเลือกการเรียงยืดหดได้", has(/\.filter-row select\{[^}]*min-width:0/));
ok("กราฟหลังบ้านเรียงลงมาทีละใบ (กันล้นขอบจอ 320px)", has(/\.cards-2\{[^}]*grid-template-columns:1fr/));
ok("รายการสินค้าหลังบ้านเหลือคอลัมน์เดียว", has(/\.product-admin-grid\{[^}]*grid-template-columns:1fr/));

section("หน้าต่างสั่งซื้อบนมือถือ");
// กล่องนี้คือจุดที่ลูกค้าเสียเงินจริง ถ้ากดปุ่มไม่โดนหรือจอเลื่อนซ้ายขวา = ขายไม่ได้
ok("กล่องสั่งซื้อกว้างเต็มจอ ไม่ล็อกความกว้างตายตัว", has(/\.buy-panel\{[^}]*max-width:100%/));
ok("ปุ่มเพิ่ม/ลดจำนวนกดโดนด้วยนิ้ว (44px)", has(/\.buy-qty-row \.qty button\{[^}]*width:44px/));
ok("ช่องกรอกจำนวนสูงพอกด (44px)", has(/#buy-qty\{[^}]*height:44px/));
ok("แถวจำนวนขึ้นบรรทัดใหม่ได้ ไม่ดันจอ", has(/\.buy-qty-row\{[^}]*flex-wrap:wrap/));
ok("รูปสินค้าในกล่องย่อลงบนมือถือ", has(/\.bh-thumb\{[^}]*flex:0 0 56px/));

section("กล่องสั่งซื้อ/แก้ข้อมูล ต้องไม่ถูกข้อความไทยยาวๆ ดันจนล้นจอ");
ok("กล่องชื่อสินค้ายอมหดได้ (min-width:0)", /\.bh-body\{[^}]*min-width:0/.test(flatCss));
ok("ชื่อสินค้ายาวๆ ตัดคำได้", /\.bh-body\{[^}]*overflow-wrap:anywhere/.test(flatCss));
ok("ข้อความเงื่อนไขตัดคำได้", /\.buy-terms li\{[^}]*overflow-wrap:anywhere/.test(flatCss));
ok("ประวัติการแก้ข้อมูลในหลังบ้านตัดคำได้", /\.ci-edit\{[^}]*overflow-wrap:anywhere/.test(flatCss));
ok("ช่องติ๊กยอมรับเงื่อนไขใหญ่พอกด (20px)", /\.buy-accept input\{[^}]*width:20px/.test(flatCss));

section("กันการ์ดถูกดันกว้างเกินจอ (ชื่อไทยยาวๆ ไม่มีที่ตัดคำ)");
const flat = css.replace(/\s*\n\s*/g, " ");
ok(".padmin ยอมหดได้ (min-width:0)", /\.padmin\{[^}]*min-width:0/.test(flat));
ok(".padmin-body ตัดคำได้ทุกจุดถ้าจำเป็น", /\.padmin-body\{[^}]*overflow-wrap:anywhere/.test(flat));

section("ไม่มีกฎเก่าที่ขัดกันหลงเหลือ");
ok("ไม่มี .table-wrap td แบบ flex ค้างอยู่", !has(/\.table-wrap td\{[^}]*display:flex/));

section("ปุ่มต้องกดโดนง่ายด้วยนิ้ว");
// jsdom คำนวณ layout จริงไม่ได้ จึงตรวจที่กฎ CSS แทน
// ปุ่มไอคอนเล็กๆ ต้องมีพื้นที่กดอย่างน้อย 40px (เดิมปุ่มคัดลอกเหลือแค่ 24x20)
ok("ปุ่มคัดลอกมีพื้นที่กดอย่างน้อย 40px", /\.copy\{[^}]*min-width:40px/.test(flat)
  && /\.copy\{[^}]*min-height:40px/.test(flat), "หากฎขนาดปุ่มคัดลอกไม่เจอ");

section("แถว 'ยังไม่มีข้อมูล' ต้องมีคลาสที่ CSS มือถือใช้จริง");
// เดิมใช้ตัวเลือก :has() ซึ่งเบราว์เซอร์เก่าไม่รู้จัก เลยเปลี่ยนมาผูกกับคลาสที่แถวแทน
// ถ้าใครเพิ่มตารางใหม่แล้วลืมใส่คลาส แถวว่างบนมือถือจะกลายเป็นการ์ดเปล่าๆ
ok("CSS มือถือผูกกับคลาส .empty-row (ไม่ใช่ :has())", has(/\.table-wrap tr\.empty-row\{/));
ok("ไม่เหลือ :has() ที่แถวว่าง", !has(/tr:has\(td\.empty\)/));
for (const file of ["admin.js", "wallet.js"]) {
  const js = fs.readFileSync(path.join(SRC, file), "utf8");
  const rows = [...js.matchAll(/<tr([^>]*)><td class="empty"/g)];
  ok(file + " สร้างแถวว่าง " + rows.length + " จุด และใส่คลาสครบทุกจุด",
    rows.length > 0 && rows.every(m => m[1].includes("empty-row")),
    rows.map(m => m[1].trim() || "(ไม่มีคลาส)").join(" · "));
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
