// ===== ทดสอบหมวดหมู่สินค้าในหลังบ้าน: ช่องเลือกหมวด + บันทึก/แก้ไข =====
import { buildSandbox, makeDom, loadI18n, tick, makeAdmin } from "./harness.mjs";
import { installAdminServer } from "./fake/admin-server.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";

buildSandbox(); makeDom("admin.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const TS = n => new fs2.Timestamp(Date.now() - n * 1000);

await QQ.registerWithEmail("908wayu@gmail.com", "adminpass", "เจ้าของร้าน", "");
installAdminServer();
await makeAdmin(QQ, store);
await tick(6);

store.put("products/pGame", { name: "ไอดีเกม A", price: 300, stock: 5, active: true, category: "game_id" });
store.put("products/pPlain", { name: "ของทั่วไป", price: 50, stock: 10, active: true });

await import("./sandbox/admin.mjs");
await tick(12);

click(document.querySelector('#tabs [data-tab="products"]'));
await tick(2);

section("ช่องเลือกหมวดหมู่ในฟอร์มสินค้า");
const opts = () => [...$("p-category").options].map(o => ({ v: o.value, t: o.textContent }));
ok("มีตัวเลือกครบ (ว่าง + 2 หมวด)", opts().length === 3, JSON.stringify(opts()));
ok("ตัวเลือกแรกคือ 'ยังไม่ระบุหมวด' ค่าว่าง", opts()[0].v === "" && opts()[0].t.includes("ยังไม่ระบุหมวด"));
ok("มีตัวเลือกไอดีเกม", opts().some(o => o.v === "game_id" && o.t.includes("ไอดีเกม")));
ok("มีตัวเลือกเติมเกม", opts().some(o => o.v === "topup" && o.t.includes("เติมเกม")));

section("เปิดแก้ไขสินค้าที่มีหมวดอยู่แล้ว");
click(document.querySelector('[data-act="edit-product"][data-id="pGame"]'));
await tick(4);
ok("ตั้งค่าช่องเลือกหมวดตรงกับสินค้า", $("p-category").value === "game_id");

section("เปิดแก้ไขสินค้าที่ยังไม่มีหมวด");
click($("product-overlay").querySelector(".btn-close"));
await tick(2);
click(document.querySelector('[data-act="edit-product"][data-id="pPlain"]'));
await tick(4);
ok("ช่องเลือกหมวดว่าง (ยังไม่ระบุ)", $("p-category").value === "");

section("แก้หมวดแล้วบันทึก");
$("p-category").value = "topup";
click($("p-save"));
await tick(10);
ok("บันทึกหมวดใหม่ลงฐานข้อมูล", store.raw("products/pPlain").category === "topup",
  "ได้ " + store.raw("products/pPlain").category);

section("เพิ่มสินค้าใหม่พร้อมเลือกหมวด");
click($("btn-add-product"));
await tick(3);
ok("ช่องเลือกหมวดว่างตอนเพิ่มสินค้าใหม่", $("p-category").value === "");
$("p-name").value = "สินค้าใหม่มีหมวด";
$("p-price").value = "150";
$("p-category").value = "game_id";
click($("p-save"));
await tick(10);
const created = [...store.state.docs.entries()].find(([k, d]) => k.startsWith("products/") && d.name === "สินค้าใหม่มีหมวด");
ok("สร้างสินค้าใหม่พร้อมหมวดที่เลือกไว้", created?.[1].category === "game_id", "ได้ " + created?.[1].category);

section("รายการสินค้าในหลังบ้านโชว์หมวด");
click(document.querySelector('#tabs [data-tab="products"]'));
await tick(2);
const rowText = id => document.querySelector(`[data-act="edit-product"][data-id="${id}"]`)
  ?.closest(".padmin")?.textContent || "";
ok("แถวสินค้าไอดีเกมโชว์คำว่าไอดีเกม", rowText("pGame").includes("ไอดีเกม"));
ok("แถวสินค้าที่เพิ่งแก้เป็นเติมเกมโชว์คำว่าเติมเกม", rowText("pPlain").includes("เติมเกม"));

section("สลับภาษาไม่ทำให้ค่าที่เลือกในช่องหมวดหาย");
click(document.querySelector('[data-act="edit-product"][data-id="pGame"]'));
await tick(4);
window.toggleLang();
await tick(2);
ok("ค่าที่เลือกยังเป็น game_id หลังสลับภาษา", $("p-category").value === "game_id");
ok("ข้อความตัวเลือกเปลี่ยนเป็นอังกฤษ",
  [...$("p-category").options].find(o => o.value === "game_id").textContent.includes("Game accounts"));
window.toggleLang();
await tick(2);

section("ช่องติ๊กขอข้อมูลไอดีลูกค้า (ของเติมเกม)");
click($("btn-add-product"));
await tick(3);
ok("มีช่องติ๊กขอ UID", !!$("p-ask-uid"));
ok("มีช่องติ๊กขอชื่อผู้ใช้ + รหัสผ่าน", !!$("p-ask-login"));
ok("สินค้าใหม่เริ่มต้นไม่ติ๊กอะไรเลย",
  $("p-ask-uid").checked === false && $("p-ask-login").checked === false);

$("p-name").value = "เพชร 100 เม็ด";
$("p-price").value = "50";
$("p-category").value = "topup";
$("p-ask-uid").checked = true;
click($("p-save"));
await tick(10);
const topup = [...store.state.docs.entries()]
  .find(([k, d]) => k.startsWith("products/") && d.name === "เพชร 100 เม็ด");
ok("บันทึก askUid ลงสินค้า", topup?.[1].askUid === true, JSON.stringify(topup?.[1]));
ok("askLogin ที่ไม่ได้ติ๊ก บันทึกเป็น false", topup?.[1].askLogin === false);

click(document.querySelector(`[data-act="edit-product"][data-id="${topup[0].split("/")[1]}"]`));
await tick(4);
ok("เปิดแก้ไขแล้วติ๊ก askUid กลับมาให้", $("p-ask-uid").checked === true);
ok("askLogin ยังไม่ติ๊กตามเดิม", $("p-ask-login").checked === false);

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
