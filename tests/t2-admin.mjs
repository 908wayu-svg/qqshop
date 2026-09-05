// ===== ทดสอบฝั่งแอดมิน: อนุมัติ/ไม่อนุมัติ ออเดอร์ เติมเงิน ปรับเครดิต ส่งมอบไอดี =====
import { buildSandbox, makeDom, loadI18n, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";

buildSandbox(); makeDom("index.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (x ? "  → " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const throws = async (fn, n) => { try { await fn(); ok(n + " (ต้อง error)", false, "ไม่ error"); } catch { ok(n, true); } };

const OWNER = "908wayu@gmail.com";
await QQ.registerWithEmail(OWNER, "adminpass", "เจ้าของร้าน", "0918200409"); await tick(5);
ok("อีเมลเจ้าของร้าน = แอดมินอัตโนมัติ", QQ.isAdmin === true);
const ADMIN_UID = QQ.user.uid;

// ลูกค้าสมมติ
store.put("users/cust1", { uid: "cust1", email: "c1@x.com", name: "ลูกค้า 1", role: "member", credit: 1000, createdAt: new fs2.Timestamp(Date.now()) });
store.put("users/cust2", { uid: "cust2", email: "c2@x.com", name: "ลูกค้า 2", role: "member", credit: 50, createdAt: new fs2.Timestamp(Date.now()) });

section("สินค้าและคลังดิจิทัล");
const pRef = await QQ.saveProduct(null, { name: "ไอดีเกม A", price: 300, active: true, digital: true, stock: 0 });
const PID = pRef.id;
ok("สินค้าดิจิทัลใหม่เริ่มที่สต๊อก 0", store.raw("products/" + PID).stock === 0);
for (let i = 1; i <= 3; i++) await QQ.saveStockItem(PID, null, { login: "user" + i, password: "pw" + i, note: "", sort: i });
const synced = await QQ.syncDigitalStock(PID);
ok("สต๊อกนับจากจำนวนชิ้นในคลัง", synced === 3 && store.raw("products/" + PID).stock === 3);

const items = await QQ.fetchStockItems(PID);
await QQ.saveStockItemsBulk(PID, [{ id: items[0].id, data: { login: "แก้แล้ว", password: "pw1", note: "" } }]);
ok("บันทึกคลังแบบชุดเดียวได้", (await QQ.fetchStockItems(PID))[0].login === "แก้แล้ว");

section("อนุมัติออเดอร์ + ส่งมอบไอดี");
const mkOrder = (id, uid, its, total) => store.put("orders/" + id, {
  uid, items: its, total, status: "pending", createdAt: new fs2.Timestamp(Date.now()),
  customerName: "ลูกค้า", customerEmail: "c@x.com", serverPriced: true,
});
mkOrder("o1", "cust1", [{ id: PID, name: "ไอดีเกม A", price: 300, qty: 2 }], 600);
await QQ.approveOrder("o1");
const o1 = store.raw("orders/o1");
ok("สถานะเป็นอนุมัติแล้ว", o1.status === "approved");
ok("หักเครดิตลูกค้าถูกต้อง", store.raw("users/cust1").credit === 400, "ได้ " + store.raw("users/cust1").credit);
ok("ตัดสต๊อกเหลือ 1", store.raw("products/" + PID).stock === 1);
ok("ส่งมอบไอดีครบ 2 ชุด", o1.items[0].delivered?.length === 2);
ok("ไอดีที่ส่งไม่ซ้ำกัน", new Set(o1.items[0].delivered.map(d => d.login)).size === 2);
const soldCount = (await QQ.fetchStockItems(PID)).filter(i => i.status === "sold").length;
ok("ชิ้นที่ขายแล้วถูกทำเครื่องหมาย", soldCount === 2);

section("กันกดซ้ำ / กดสวนกัน");
await throws(() => QQ.approveOrder("o1"), "อนุมัติออเดอร์เดิมซ้ำไม่ได้");
await throws(() => QQ.rejectOrder("o1"), "กด 'ไม่อนุมัติ' ทับออเดอร์ที่อนุมัติแล้วไม่ได้");
ok("เครดิตไม่เปลี่ยนหลังกดพลาด", store.raw("users/cust1").credit === 400);
ok("สถานะยังเป็นอนุมัติ", store.raw("orders/o1").status === "approved");

mkOrder("o2", "cust2", [{ id: PID, name: "ไอดีเกม A", price: 300, qty: 1 }], 300);
await throws(() => QQ.approveOrder("o2"), "เครดิตลูกค้าไม่พอ = อนุมัติไม่ได้");
ok("ไม่มีอะไรถูกเขียนตอนล้มเหลว", store.raw("orders/o2").status === "pending"
  && store.raw("products/" + PID).stock === 1
  && (store.raw("users/cust2").credit === 50));

mkOrder("o3", "cust1", [{ id: PID, name: "ไอดีเกม A", price: 300, qty: 5 }], 1500);
await throws(() => QQ.approveOrder("o3"), "ของในคลังไม่พอ = อนุมัติไม่ได้");
ok("คลังไม่ถูกแตะตอนของไม่พอ", (await QQ.fetchStockItems(PID)).filter(i => i.status === "sold").length === 2);

section("ไม่อนุมัติออเดอร์");
mkOrder("o4", "cust1", [{ id: PID, name: "ไอดีเกม A", price: 300, qty: 1 }], 300);
await QQ.rejectOrder("o4", "สลิปไม่ชัด");
ok("ไม่อนุมัติได้", store.raw("orders/o4").status === "rejected");
ok("ไม่หักเครดิตตอนไม่อนุมัติ", store.raw("users/cust1").credit === 400);
await throws(() => QQ.rejectOrder("o4"), "ไม่อนุมัติซ้ำไม่ได้");
await throws(() => QQ.approveOrder("o4"), "อนุมัติออเดอร์ที่ปฏิเสธไปแล้วไม่ได้");

section("เติมเงิน (แอดมิน)");
store.put("topups/t1", { uid: "cust1", amount: 250, method: "bank", hasSlip: true, status: "pending", createdAt: new fs2.Timestamp(Date.now()) });
await QQ.approveTopup("t1");
ok("เครดิตเข้าหลังอนุมัติ", store.raw("users/cust1").credit === 650, "ได้ " + store.raw("users/cust1").credit);
await throws(() => QQ.approveTopup("t1"), "อนุมัติเติมเงินซ้ำไม่ได้");
await throws(() => QQ.rejectTopup("t1"), "ปฏิเสธรายการที่อนุมัติแล้วไม่ได้");
ok("เครดิตไม่เพิ่มซ้ำ", store.raw("users/cust1").credit === 650);

store.put("topups/t2", { uid: "cust1", amount: 0, method: "angpao", status: "pending", angpaoLink: "https://gift.truemoney.com/campaign/?v=abc", createdAt: new fs2.Timestamp(Date.now()) });
await throws(() => QQ.approveTopup("t2"), "รายการยอด 0 ต้องใส่ยอดก่อนถึงอนุมัติได้");
await QQ.approveTopup("t2", 125.5);
ok("ใส่ยอดเองแล้วอนุมัติได้", store.raw("topups/t2").amount === 125.5);
ok("เครดิตบวกยอดที่ใส่", store.raw("users/cust1").credit === 775.5, "ได้ " + store.raw("users/cust1").credit);

store.put("topups/t3", { uid: "cust1", amount: 99, method: "angpao", status: "processing", createdAt: new fs2.Timestamp(Date.now()) });
await QQ.approveTopup("t3");
ok("รายการที่บอทค้าง (processing) แอดมินอนุมัติได้", store.raw("topups/t3").status === "approved");

section("ปรับเครดิต");
const before = store.raw("users/cust1").credit;
await QQ.adjustCredit("cust1", 100, "โบนัส");
ok("เพิ่มเครดิตได้", store.raw("users/cust1").credit === before + 100);
await QQ.adjustCredit("cust1", -50, "หักคืน");
ok("หักเครดิตได้", store.raw("users/cust1").credit === before + 50);
await throws(() => QQ.adjustCredit("cust1", -999999), "หักจนติดลบไม่ได้");
ok("เครดิตไม่เปลี่ยนตอนหักเกิน", store.raw("users/cust1").credit === before + 50);
await throws(() => QQ.adjustCredit("ไม่มีคนนี้", 100), "ปรับเครดิตให้คนที่ไม่มีอยู่ไม่ได้");
const logs = [...store.state.docs.entries()].filter(([p, d]) => p.startsWith("topups/") && d.method === "admin");
ok("มีประวัติทุกครั้งที่ปรับเครดิต", logs.length === 2);

section("จำนวนเงินทศนิยม");
store.put("users/cust3", { uid: "cust3", email: "c3@x.com", name: "ลูกค้า 3", role: "member", credit: 0, createdAt: new fs2.Timestamp(Date.now()) });
await QQ.adjustCredit("cust3", 0.1); await QQ.adjustCredit("cust3", 0.2);
ok("0.1 + 0.2 = 0.3 พอดี", store.raw("users/cust3").credit === 0.3, "ได้ " + store.raw("users/cust3").credit);

section("แอดมินอ่านได้ทุกอย่าง");
ok("ดึงสมาชิกได้", (await QQ.fetchUsers()).length >= 4);
ok("ดึงออเดอร์ได้", (await QQ.fetchOrders()).length === 4);
ok("ดึงรายการเติมเงินได้", (await QQ.fetchTopups()).length >= 3);
ok("อ่านคลังไอดีได้", (await QQ.fetchStockItems(PID)).length === 3);
ok("ดูสลิปของลูกค้าได้", true);

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;

section("แย่งของชิ้นสุดท้ายพร้อมกัน");
// สมมติ: ระหว่างที่แอดมินกดอนุมัติออเดอร์ A ของชิ้นนั้นถูกออเดอร์ B คว้าไปก่อน
const P2 = (await QQ.saveProduct(null, { name: "ของชิ้นเดียว", price: 100, active: true, digital: true, stock: 0 })).id;
await QQ.saveStockItem(P2, null, { login: "last", password: "one", note: "", sort: 1 });
await QQ.syncDigitalStock(P2);
store.put("users/race1", { uid: "race1", email: "r1@x.com", name: "แย่ง 1", role: "member", credit: 500, createdAt: new fs2.Timestamp(Date.now()) });
store.put("users/race2", { uid: "race2", email: "r2@x.com", name: "แย่ง 2", role: "member", credit: 500, createdAt: new fs2.Timestamp(Date.now()) });
mkOrder("rA", "race1", [{ id: P2, name: "ของชิ้นเดียว", price: 100, qty: 1 }], 100);
mkOrder("rB", "race2", [{ id: P2, name: "ของชิ้นเดียว", price: 100, qty: 1 }], 100);

await QQ.approveOrder("rA");
ok("คนแรกได้ของ", store.raw("orders/rA").items[0].delivered?.[0]?.login === "last");
await throws(() => QQ.approveOrder("rB"), "คนที่สองไม่ได้ของซ้ำ");
ok("คนที่สองยังไม่ถูกหักเครดิต", store.raw("users/race2").credit === 500);
ok("ออเดอร์คนที่สองยังรออนุมัติ", store.raw("orders/rB").status === "pending");
ok("สต๊อกไม่ติดลบ", store.raw("products/" + P2).stock === 0, "ได้ " + store.raw("products/" + P2).stock);

section("สินค้าชิ้นเดียวถูกสั่งซ้ำในออเดอร์เดียว");
const P3 = (await QQ.saveProduct(null, { name: "รหัสซ้ำในออเดอร์", price: 50, active: true, digital: true, stock: 0 })).id;
for (let i = 1; i <= 3; i++) await QQ.saveStockItem(P3, null, { login: "d" + i, password: "p", note: "", sort: i });
await QQ.syncDigitalStock(P3);
store.put("users/dup", { uid: "dup", email: "d@x.com", name: "ซ้ำ", role: "member", credit: 500, createdAt: new fs2.Timestamp(Date.now()) });
mkOrder("dupA", "dup", [
  { id: P3, name: "รหัสซ้ำในออเดอร์", price: 50, qty: 1 },
  { id: P3, name: "รหัสซ้ำในออเดอร์", price: 50, qty: 2 },
], 150);
await QQ.approveOrder("dupA");
const dOrder = store.raw("orders/dupA");
ok("แถวแรกได้ 1 ชุด", dOrder.items[0].delivered?.length === 1);
ok("แถวสองได้ 2 ชุด", dOrder.items[1].delivered?.length === 2);
const allLogins = [...dOrder.items[0].delivered, ...dOrder.items[1].delivered].map(d => d.login);
ok("ทั้ง 3 ชุดไม่ซ้ำกัน", new Set(allLogins).size === 3, allLogins.join(","));
ok("สต๊อกถูกตัดครบ 3 ไม่ตัดซ้ำ", store.raw("products/" + P3).stock === 0, "ได้ " + store.raw("products/" + P3).stock);
ok("หักเครดิตครั้งเดียวตามยอดรวม", store.raw("users/dup").credit === 350, "ได้ " + store.raw("users/dup").credit);

console.log("\nสรุป(รวมท้าย): ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;

section("ชิ้นในคลังที่ยังไม่ได้กรอกไอดี ต้องยังไม่ขึ้นขาย");
const P4 = (await QQ.saveProduct(null, { name: "รอกรอกข้อมูล", price: 100, active: true, digital: true, stock: 0 })).id;
await QQ.saveStockItem(P4, null, { login: "", password: "", note: "", sort: 1 });
await QQ.saveStockItem(P4, null, { login: "", password: "", note: "", sort: 2 });
await QQ.syncDigitalStock(P4);
ok("กดเพิ่มชิ้นเปล่าแล้วสต๊อกยังเป็น 0", store.raw("products/" + P4).stock === 0, "ได้ " + store.raw("products/" + P4).stock);
const empties = await QQ.fetchStockItems(P4);
ok("ชิ้นเปล่าถูกทำเครื่องหมายว่าเป็นร่าง", empties.every(i => i.status === "draft"));

await QQ.saveStockItemsBulk(P4, [{ id: empties[0].id, data: { login: "realuser", password: "realpw", note: "" } }]);
await QQ.syncDigitalStock(P4);
ok("กรอกข้อมูลแล้วสต๊อกขึ้นเป็น 1", store.raw("products/" + P4).stock === 1, "ได้ " + store.raw("products/" + P4).stock);

store.put("users/draftbuyer", { uid: "draftbuyer", email: "d@x.com", name: "ผู้ซื้อ", role: "member", credit: 500, createdAt: new fs2.Timestamp(Date.now()) });
mkOrder("draftA", "draftbuyer", [{ id: P4, name: "รอกรอกข้อมูล", price: 100, qty: 2 }], 200);
await throws(() => QQ.approveOrder("draftA"), "ขายเกินจำนวนชิ้นที่กรอกจริงไม่ได้");
mkOrder("draftB", "draftbuyer", [{ id: P4, name: "รอกรอกข้อมูล", price: 100, qty: 1 }], 100);
await QQ.approveOrder("draftB");
const got = store.raw("orders/draftB").items[0].delivered;
ok("ลูกค้าได้ชิ้นที่กรอกข้อมูลไว้จริง", got?.[0]?.login === "realuser", JSON.stringify(got));
ok("ไม่มีทางได้ไอดีว่างเปล่า", got.every(d => d.login || d.password));

console.log("\nสรุป(รวมท้าย2): ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;

section("ซ่อมข้อมูลเก่า: ชิ้นว่างที่เคยถูกตั้งเป็นพร้อมขาย");
const P5 = (await QQ.saveProduct(null, { name: "ของเก่ามีปัญหา", price: 100, active: true, digital: true, stock: 0 })).id;
// จำลองข้อมูลที่ค้างมาจากโค้ดเวอร์ชันเก่า
store.put("products/" + P5 + "/stockItems/old1", { login: "", password: "", note: "", status: "available", sort: 1 });
store.put("products/" + P5 + "/stockItems/old2", { login: "ของจริง", password: "pw", note: "", status: "available", sort: 2 });
const fixed = await QQ.syncDigitalStock(P5);
ok("นับเฉพาะชิ้นที่มีข้อมูลจริง", fixed === 1, "ได้ " + fixed);
ok("ชิ้นว่างถูกลดเป็นร่างให้อัตโนมัติ", store.raw("products/" + P5 + "/stockItems/old1").status === "draft");
ok("ชิ้นที่มีข้อมูลไม่ถูกแตะ", store.raw("products/" + P5 + "/stockItems/old2").status === "available");

// กันชั้นสุดท้าย: ถึงหลุดมาถึงตอนอนุมัติก็ต้องไม่ส่งของว่าง
store.put("products/" + P5 + "/stockItems/old1", { login: "", password: "", note: "", status: "available", sort: 1 });
store.put("products/" + P5, { ...store.raw("products/" + P5), stock: 2 });
mkOrder("emptyA", "draftbuyer", [{ id: P5, name: "ของเก่ามีปัญหา", price: 100, qty: 2 }], 200);
await throws(() => QQ.approveOrder("emptyA"), "อนุมัติแล้วเจอชิ้นว่าง = หยุดไว้ ไม่ส่งของว่าง");
ok("ออเดอร์ยังไม่ถูกอนุมัติ", store.raw("orders/emptyA").status === "pending");
ok("ยังไม่หักเครดิตลูกค้า", store.raw("users/draftbuyer").credit === 400, "ได้ " + store.raw("users/draftbuyer").credit);

console.log("\nสรุป(รวมท้าย3): ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
