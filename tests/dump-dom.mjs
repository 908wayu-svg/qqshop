// ===== เครื่องมือช่วยตรวจหน้าจอมือถือ =====
// รันหน้าจริง + ข้อมูลจำลองในตัวทดสอบ แล้วดัมป์ HTML ที่ render ออกมาเป็นไฟล์
// เอาไปเปิดใน Chrome จริงเพื่อดูว่า CSS พังตรงไหนบนจอมือถือ (jsdom ไม่คำนวณ layout ให้)
// ใช้: node dump-dom.mjs <admin|purchases> <ไฟล์ปลายทาง>
import { buildSandbox, makeDom, loadI18n, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";
import fs from "fs";

const which = process.argv[2] || "admin";
const out = process.argv[3] || ("dump-" + which + ".html");
const TS = n => new fs2.Timestamp(Date.now() - n * 1000);
const IMG = "data:image/jpeg;base64," + "A".repeat(120) + "==";

buildSandbox();
makeDom(which + ".html");
loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

if (which === "admin") {
  await QQ.registerWithEmail("908wayu@gmail.com", "adminpass", "เจ้าของร้าน", "");
  await tick(6);

  store.put("users/c1", { uid: "c1", email: "ลูกค้าอีเมลยาวมากจริงๆนะ@gmail.com", name: "ลูกค้า ชื่อยาวมากเพื่อทดสอบ", role: "member", credit: 1250, createdAt: TS(500), provider: "google" });
  store.put("users/c2", { uid: "c2", email: "c2@x.com", name: "ลูกค้า สอง", role: "member", credit: 20, createdAt: TS(400), provider: "email" });

  store.put("products/pA", { name: "ไอดีเกม Free Fire ระดับตำนาน", price: 1300, stock: 3, active: true, digital: true, category: "game_id", image: IMG });
  store.put("products/pB", { name: "เพชร 100 เม็ด", price: 50, stock: 10, active: true, category: "topup" });
  store.put("products/pC", { name: "ของยังไม่ระบุหมวด", price: 90, stock: 2, active: false });

  store.put("orders/o1", { uid: "c1", customerName: "ลูกค้า ชื่อยาวมากเพื่อทดสอบ", customerEmail: "ลูกค้าอีเมลยาวมากจริงๆนะ@gmail.com",
    total: 2600, status: "pending", createdAt: TS(100),
    items: [{ id: "pA", name: "ไอดีเกม Free Fire ระดับตำนาน", price: 1300, qty: 2 }] });
  store.put("orders/o2", { uid: "c2", customerName: "ลูกค้า สอง", customerEmail: "c2@x.com", total: 50, status: "approved",
    createdAt: TS(80), approvedAt: TS(70), items: [{ id: "pB", name: "เพชร 100 เม็ด", price: 50, qty: 1 }] });

  store.put("topups/t1", { uid: "c1", name: "ลูกค้า ชื่อยาวมากเพื่อทดสอบ", email: "ลูกค้าอีเมลยาวมากจริงๆนะ@gmail.com",
    amount: 500, method: "bank", hasSlip: true, status: "pending", createdAt: TS(50) });
  store.put("topupSlips/t1", { uid: "c1", slip: IMG });
  store.put("topups/t2", { uid: "c2", name: "ลูกค้า สอง", email: "c2@x.com", amount: 0, method: "angpao",
    angpaoLink: "https://gift.truemoney.com/campaign/?v=ABC123", status: "pending", note: "ต้องตรวจสอบด้วยมือ", createdAt: TS(40) });

  await import("./sandbox/admin.mjs");
  await tick(14);
} else {
  await QQ.registerWithEmail("member@test.com", "secret123", "สมาชิกทดสอบ", "0800000000");
  await tick(6);
  const uid = QQ.user.uid;
  store.state.docs.set("users/" + uid, { ...store.raw("users/" + uid), credit: 750 });

  store.put("orders/o1", { uid, total: 1300, status: "approved", createdAt: TS(200), approvedAt: TS(150),
    items: [{ id: "pA", name: "ไอดีเกม Free Fire ระดับตำนาน", price: 1300, qty: 1,
      delivered: [{ login: "freefire_player_009@example.com", password: "SuperSecret#2569",
        note: "เปลี่ยนรหัสผ่านทันทีหลังได้รับ ห้ามผูกเบอร์เดิม" }] }] });
  store.put("orders/o2", { uid, total: 100, status: "pending", createdAt: TS(100),
    items: [{ id: "pB", name: "เพชร 100 เม็ด", price: 50, qty: 2 }] });
  store.put("orders/o3", { uid, total: 90, status: "rejected", createdAt: TS(60),
    items: [{ id: "pC", name: "ของที่ถูกปฏิเสธ", price: 90, qty: 1 }] });

  await import("./sandbox/purchases.mjs");
  await tick(14);
}

// ชี้ CSS/รูปกลับไปที่เซิร์ฟเวอร์ไฟล์จริง เพื่อให้ Chrome โหลดสไตล์ชุดเดียวกับเว็บจริง
let html = document.documentElement.outerHTML
  .replace(/(href|src)="(?!http|data:)([^"]+)"/g, '$1="http://localhost:8231/$2"');
fs.writeFileSync(out, "<!DOCTYPE html>\n" + html);
console.log("เขียน", out, html.length, "ตัวอักษร");
