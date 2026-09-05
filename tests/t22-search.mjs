// ===== ทดสอบค้นหาสินค้า + กรองช่วงราคา + เรียงลำดับ หน้าร้าน =====
// จุดที่พังง่าย:
//  - ช่องราคาเว้นว่างแล้วถูกอ่านเป็น 0 → ของราคา 0 บาทหายหมด / กรองผิดเงียบๆ
//  - ตัวกรองไม่ทำงานร่วมกับแท็บหมวดหมู่ (กรองแล้วหลุดข้ามหมวด)
//  - หาไม่เจอแล้วขึ้นข้อความเดียวกับ "ร้านยังไม่มีของ" ลูกค้าเข้าใจผิดว่าร้านว่าง
//  - สลับภาษาแล้วคำค้นที่พิมพ์ไว้หาย
import { buildSandbox, makeDom, loadI18n, runClassic, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";

buildSandbox(); makeDom("index.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

// พิมพ์ลงช่อง แล้วรอให้วาดใหม่
async function type(id, value) {
  $(id).value = value;
  $(id).dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(2);
}
async function choose(id, value) {
  $(id).value = value;
  $(id).dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(2);
}
const names = () => [...document.querySelectorAll("#grid .product h3")].map(h => h.textContent);
const gridText = () => $("grid").textContent.replace(/\s+/g, " ").trim();

store.put("products/p1", { name: "ไอดี Free Fire ระดับ 50", name_en: "Free Fire account level 50",
  price: 300, stock: 5, active: true, category: "game_id", sort: 1 });
store.put("products/p2", { name: "ไอดี ROV ยศเซียน", name_en: "ROV master account",
  price: 1200, stock: 2, active: true, category: "game_id", sort: 2 });
store.put("products/p3", { name: "เพชร 100 เม็ด", name_en: "100 diamonds",
  price: 50, stock: 99, active: true, category: "topup", sort: 3 });
store.put("products/p4", { name: "เพชร 1000 เม็ด", name_en: "1000 diamonds",
  price: 450, stock: 99, active: true, category: "topup", sort: 4 });
store.put("products/p5", { name: "ของแถมฟรี", desc: "แจกฟรีสำหรับลูกค้าเก่า",
  price: 0, stock: 3, active: true, category: "topup", sort: 5 });
store.put("products/p6", { name: "ไอดีปิดขายอยู่", price: 99, active: false, category: "game_id", sort: 6 });

runClassic("app.js");
document.dispatchEvent(new window.Event("DOMContentLoaded"));
await tick(8);

section("แถบเครื่องมือมีครบ");
ok("มีช่องค้นหา", !!$("q"));
ok("มีช่องราคาต่ำสุด/สูงสุด", !!$("pmin") && !!$("pmax"));
ok("มีตัวเลือกการเรียงลำดับ", !!$("sort"));
ok("มีตัวเลือกเรียง 4 แบบ", $("sort").querySelectorAll("option").length === 4);
ok("ปุ่มล้างคำค้นซ่อนอยู่ตอนยังไม่ได้พิมพ์", $("q-clear").classList.contains("hidden"));
ok("ปุ่มล้างตัวกรองซ่อนอยู่ตอนยังไม่ได้กรอง", $("clear-filters").classList.contains("hidden"));
ok("ยังไม่ได้กรอง = ไม่ต้องโชว์จำนวนที่พบ", $("result-count").textContent === "", $("result-count").textContent);

section("ตอนเปิดหน้า โชว์ของที่เปิดขายทั้งหมด");
ok("เห็นสินค้า 5 ชิ้น (ไม่รวมที่ปิดขาย)", names().length === 5, names().join(" | "));
ok("ไม่มีสินค้าที่ปิดขาย", !names().some(n => n.includes("ปิดขาย")));

section("ค้นหาด้วยชื่อไทย");
await type("q", "เพชร");
ok("เหลือเฉพาะของที่ชื่อมีคำว่าเพชร", names().length === 2, names().join(" | "));
ok("ปุ่มล้างคำค้นโผล่ขึ้นมา", !$("q-clear").classList.contains("hidden"));
ok("ปุ่มล้างตัวกรองโผล่ขึ้นมา", !$("clear-filters").classList.contains("hidden"));
ok("บอกจำนวนที่พบ", $("result-count").textContent.includes("2"), $("result-count").textContent);

section("พิมพ์หลายคำ = ต้องเจอทุกคำ");
await type("q", "เพชร 1000");
ok("เจอเฉพาะเพชร 1000 เม็ด", names().length === 1 && names()[0] === "เพชร 1000 เม็ด", names().join(" | "));
await type("q", "เพชร ทองคำ");
ok("คำที่ไม่มีอยู่จริง = ไม่เจอสักชิ้น", names().length === 0);

section("หาไม่เจอ ต้องบอกให้ถูกว่าเป็นเพราะตัวกรอง ไม่ใช่ร้านว่าง");
ok("ขึ้นข้อความว่าหาไม่เจอ", gridText().includes("ไม่พบสินค้าที่ตรงกับที่ค้นหา"), gridText());
ok("ไม่ขึ้นข้อความ 'ยังไม่มีข้อมูล'", !gridText().includes("ยังไม่มีข้อมูล"));
ok("มีคำแนะนำว่าให้ทำอะไรต่อ", gridText().includes("ล้างตัวกรอง"), gridText());

section("ค้นด้วยภาษาอังกฤษ / ไม่สนตัวพิมพ์เล็กใหญ่");
await type("q", "DIAMONDS");
ok("พิมพ์ตัวใหญ่ก็เจอชื่ออังกฤษ", names().length === 2, names().join(" | "));
await type("q", "free fire");
ok("เจอจากชื่ออังกฤษของสินค้าไทย", names().length === 1 && names()[0].includes("Free Fire"), names().join(" | "));

section("ค้นจากคำอธิบายสินค้าได้ด้วย");
await type("q", "ลูกค้าเก่า");
ok("เจอจากข้อความในคำอธิบาย", names().length === 1 && names()[0] === "ของแถมฟรี", names().join(" | "));

section("ปุ่มกากบาทล้างคำค้น");
click($("q-clear"));
await tick(2);
ok("ช่องค้นหาว่างแล้ว", $("q").value === "");
ok("กลับมาเห็นครบ 5 ชิ้น", names().length === 5, names().join(" | "));
ok("ปุ่มกากบาทซ่อนกลับ", $("q-clear").classList.contains("hidden"));

section("กรองช่วงราคา");
await type("pmin", "100");
ok("ราคาตั้งแต่ 100 ขึ้นไป เหลือ 3 ชิ้น", names().length === 3, names().join(" | "));
await type("pmax", "500");
ok("ราคา 100-500 เหลือ 2 ชิ้น", names().length === 2, names().join(" | "));
ok("ไม่มีของราคา 1200 ปนมา", !names().some(n => n.includes("ROV")));
await type("pmin", "");
await type("pmax", "0");
ok("สูงสุด 0 บาท = เหลือเฉพาะของฟรี", names().length === 1 && names()[0] === "ของแถมฟรี", names().join(" | "));

section("ช่องราคาเว้นว่าง ต้องไม่ถูกนับเป็น 0");
await type("pmax", "");
ok("ล้างช่องแล้วกลับมาครบ 5 ชิ้น (ของราคา 0 บาทไม่หาย)", names().length === 5, names().join(" | "));
ok("ปุ่มล้างตัวกรองซ่อนกลับเมื่อไม่มีตัวกรองเหลือ", $("clear-filters").classList.contains("hidden"));

section("ใส่ราคาต่ำสุดมากกว่าสูงสุด ต้องเตือนให้รู้ตัว");
await type("pmin", "900");
await type("pmax", "100");
ok("ไม่เจอสินค้า", names().length === 0);
ok("บอกว่าใส่ตัวเลขสลับกัน", gridText().includes("สลับตัวเลข"), gridText());
await type("pmin", ""); await type("pmax", "");

section("ค่าติดลบ/ตัวอักษร ต้องไม่ทำให้รายการหาย");
await type("pmin", "-50");
ok("ราคาติดลบ = ไม่กรอง", names().length === 5, names().join(" | "));
await type("pmin", "");

section("เรียงลำดับ");
await choose("sort", "price_asc");
ok("ถูก → แพง", names().join("|") === "ของแถมฟรี|เพชร 100 เม็ด|ไอดี Free Fire ระดับ 50|เพชร 1000 เม็ด|ไอดี ROV ยศเซียน",
  names().join("|"));
await choose("sort", "price_desc");
ok("แพง → ถูก", names()[0].includes("ROV") && names()[4] === "ของแถมฟรี", names().join("|"));
await choose("sort", "name");
ok("เรียงตามชื่อ", names().join("|") === [...names()].sort((a, b) => a.localeCompare(b, "th")).join("|"),
  names().join("|"));
await choose("sort", "default");
ok("กลับไปลำดับที่ร้านจัดไว้", names()[0].includes("Free Fire") && names()[4] === "ของแถมฟรี", names().join("|"));

section("ตัวกรองทำงานร่วมกับแท็บหมวดหมู่");
click(document.querySelector('.cat-tab[data-cat="topup"]'));
await tick(2);
ok("เข้าหมวดเติมเกม เห็น 3 ชิ้น", names().length === 3, names().join(" | "));
await type("q", "เพชร");
ok("ค้นในหมวดเติมเกม เหลือ 2 ชิ้น", names().length === 2, names().join(" | "));
await type("q", "ROV");
ok("ของหมวดอื่นไม่หลุดเข้ามาแม้จะตรงคำค้น", names().length === 0, names().join(" | "));
click(document.querySelector('.cat-tab[data-cat="all"]'));
await tick(2);
ok("ย้ายกลับหมวดทั้งหมด คำค้นยังอยู่", $("q").value === "ROV" && names().length === 1, names().join(" | "));

section("ปุ่มล้างตัวกรอง ล้างทุกอย่างในทีเดียว");
await type("pmin", "100");
await choose("sort", "price_desc");
click($("clear-filters"));
await tick(2);
ok("คำค้นถูกล้าง", $("q").value === "");
ok("ช่วงราคาถูกล้าง", $("pmin").value === "" && $("pmax").value === "");
ok("การเรียงกลับเป็นค่าเริ่มต้น", $("sort").value === "default");
ok("เห็นสินค้าครบเหมือนเดิม", names().length === 5, names().join(" | "));

section("สลับภาษาแล้วตัวกรองต้องไม่หาย");
await type("q", "diamonds");
window.toggleLang();
await tick(2);
ok("คำค้นยังอยู่", $("q").value === "diamonds");
ok("ยังกรองอยู่เหมือนเดิม", names().length === 2, names().join(" | "));
ok("ชื่อสินค้าเปลี่ยนเป็นอังกฤษ", names().every(n => /diamonds/i.test(n)), names().join(" | "));
ok("คำใบ้ในช่องค้นหาแปลตามภาษา", $("q").placeholder.includes("Search"), $("q").placeholder);
ok("ตัวเลือกการเรียงแปลตามภาษา",
  $("sort").querySelector('option[value="price_asc"]').textContent.includes("low"),
  $("sort").querySelector('option[value="price_asc"]').textContent);
ok("ข้อความจำนวนที่พบแปลตามภาษา", $("result-count").textContent.includes("Found"), $("result-count").textContent);
window.toggleLang();
await tick(2);

section("ร้านไม่มีของเลย ต้องขึ้น 'ยังไม่มีข้อมูล' ไม่ใช่ข้อความหาไม่เจอ");
click($("clear-filters"));
await tick(2);
for (const id of ["p1", "p2", "p3", "p4", "p5", "p6"]) store.state.docs.delete("products/" + id);
await loadProducts();
await tick(2);
ok("ขึ้นข้อความว่ายังไม่มีข้อมูล", gridText().includes("ยังไม่มีข้อมูล"), gridText());
ok("ไม่ขึ้นข้อความหาไม่เจอ", !gridText().includes("ไม่พบสินค้า"), gridText());

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
