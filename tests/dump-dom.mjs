// ===== เครื่องมือช่วยตรวจหน้าจอมือถือ =====
// รันหน้าจริง + ข้อมูลจำลองในตัวทดสอบ แล้วดัมป์ HTML ที่ render ออกมาเป็นไฟล์
// เอาไปเปิดใน Chrome จริงเพื่อดูว่า CSS พังตรงไหนบนจอมือถือ (jsdom ไม่คำนวณ layout ให้)
// ใช้: node dump-dom.mjs <admin|purchases|index|buy> <ไฟล์ปลายทาง>
//   index = หน้าร้าน · buy = หน้าร้านที่เปิดหน้าต่างสั่งซื้อค้างไว้
import { buildSandbox, makeDom, loadI18n, tick, makeAdmin } from "./harness.mjs";
import { installAdminServer } from "./fake/admin-server.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";
import { runClassic } from "./harness.mjs";
import fs from "fs";

const which = process.argv[2] || "admin";
const out = process.argv[3] || ("dump-" + which + ".html");
const TS = n => new fs2.Timestamp(Date.now() - n * 1000);
const IMG = "data:image/jpeg;base64," + "A".repeat(120) + "==";

buildSandbox();
makeDom((which === "buy" ? "index" : which) + ".html");
loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

if (which === "index" || which === "buy") {
  globalThis.window.QQ = QQ;
  await QQ.registerWithEmail("member@test.com", "secret123", "สมาชิกทดสอบ", "0800000000");
  await tick(6);
  store.state.docs.set("users/" + QQ.user.uid, { ...store.raw("users/" + QQ.user.uid), credit: 750 });

  store.put("products/pA", { name: "ไอดีเกม Free Fire ระดับตำนาน ชื่อยาวมากเพื่อทดสอบการตัดคำบนจอแคบ",
    desc: "ไอดีของแท้ พร้อมสกินครบ รับประกันเข้าเล่นได้จริง", price: 1300, stock: 3, active: true,
    digital: true, category: "game_id", image: IMG });
  store.put("products/pB", { name: "เพชร 100 เม็ด", price: 50, stock: 10, active: true,
    category: "topup", askUid: true, askLogin: true });
  store.put("products/pC", { name: "ของหมดแล้ว", price: 90, stock: 0, active: true });
  store.put("products/pA/stockItems/s1", { login: "u1", password: "p1", status: "available", sort: 1 });

  const app = runClassic("app.js");
  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await tick(14);
  // "buy" = เปิดหน้าต่างสั่งซื้อของที่ต้องกรอกข้อมูลมากที่สุด (ยาวที่สุด = เสี่ยงล้นจอที่สุด)
  if (which === "buy") { app.openBuy("pB"); await tick(6); }
} else if (which === "admin") {
  await QQ.registerWithEmail("908wayu@gmail.com", "adminpass", "เจ้าของร้าน", "");
  installAdminServer();
  await makeAdmin(QQ, store);      // สิทธิ์แอดมิน = custom claim + role ในเอกสาร ต้องครบทั้งคู่
  await tick(6);

  store.put("users/c1", { uid: "c1", email: "ลูกค้าอีเมลยาวมากจริงๆนะ@gmail.com", name: "ลูกค้า ชื่อยาวมากเพื่อทดสอบ", role: "member", credit: 1250, createdAt: TS(500), provider: "google" });
  store.put("users/c2", { uid: "c2", email: "c2@x.com", name: "ลูกค้า สอง", role: "member", credit: 20, createdAt: TS(400), provider: "email" });

  store.put("products/pA", { name: "ไอดีเกม Free Fire ระดับตำนาน", price: 1300, stock: 3, active: true, digital: true, category: "game_id", image: IMG });
  store.put("products/pB", { name: "เพชร 100 เม็ด", price: 50, stock: 10, active: true, category: "topup" });
  store.put("products/pC", { name: "ของยังไม่ระบุหมวด", price: 90, stock: 2, active: false });

  store.put("orders/o1", { uid: "c1", customerName: "ลูกค้า ชื่อยาวมากเพื่อทดสอบ", customerEmail: "ลูกค้าอีเมลยาวมากจริงๆนะ@gmail.com",
    total: 2600, status: "pending", createdAt: TS(100),
    items: [{ id: "pA", name: "ไอดีเกม Free Fire ระดับตำนาน", price: 1300, qty: 2 }] });
  store.put("orders/o2", { uid: "c2", customerName: "ลูกค้า สอง", customerEmail: "c2@x.com", total: 50, status: "completed",
    paid: true, kind: "digital", createdAt: TS(80), completedAt: TS(70),
    items: [{ id: "pB", name: "เพชร 100 เม็ด", price: 50, qty: 1 }] });
  store.put("orders/o3", { uid: "c1", customerName: "ลูกค้า ชื่อยาวมากเพื่อทดสอบ",
    customerEmail: "ลูกค้าอีเมลยาวมากจริงๆนะ@gmail.com", total: 100, status: "pending", paid: true, kind: "topup",
    createdAt: TS(60), infoEdits: [{ at: TS(58), index: 0, field: "gameUid", from: "111222333" }],
    items: [{ id: "pB", name: "เพชร 100 เม็ด", price: 50, qty: 2,
      gameUid: "998877665544", gameLogin: "myaccount@example.com", gamePassword: "SuperSecret#2569" }] });
  store.put("orders/o4", { uid: "c2", customerName: "ลูกค้า สอง", customerEmail: "c2@x.com", total: 50,
    status: "processing", paid: true, kind: "topup", createdAt: TS(55),
    items: [{ id: "pB", name: "เพชร 100 เม็ด", price: 50, qty: 1, gameUid: "123456" }] });

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

  store.put("orders/o1", { uid, total: 1300, status: "completed", paid: true, kind: "digital",
    createdAt: TS(200), completedAt: TS(150),
    claimTimerStartedAt: new fs2.Timestamp(Date.now() - 120000),
    items: [{ id: "pA", name: "ไอดีเกม Free Fire ระดับตำนาน", price: 1300, qty: 1,
      delivered: [{ login: "freefire_player_009@example.com", password: "SuperSecret#2569",
        note: "เปลี่ยนรหัสผ่านทันทีหลังได้รับ ห้ามผูกเบอร์เดิม" }] }] });
  store.put("orders/o2", { uid, total: 100, status: "pending", paid: true, kind: "topup",
    createdAt: TS(100), infoEditedAt: TS(90),
    items: [{ id: "pB", name: "เพชร 100 เม็ด", price: 50, qty: 2,
      gameUid: "998877665544", gameLogin: "myaccount@example.com", gamePassword: "SuperSecret#2569" }] });
  store.put("orders/o3", { uid, total: 90, status: "cancelled", paid: true, refundAmount: 90,
    note: "ของหมดจริง คืนเครดิตให้แล้ว", createdAt: TS(60), cancelledAt: TS(50),
    items: [{ id: "pC", name: "ของที่ถูกยกเลิก", price: 90, qty: 1 }] });

  await import("./sandbox/purchases.mjs");
  await tick(14);
}

// ชี้ CSS/รูปกลับไปที่เซิร์ฟเวอร์ไฟล์จริง เพื่อให้ Chrome โหลดสไตล์ชุดเดียวกับเว็บจริง
let html = document.documentElement.outerHTML
  .replace(/(href|src)="(?!http|data:)([^"]+)"/g, '$1="http://localhost:8231/$2"');
fs.writeFileSync(out, "<!DOCTYPE html>\n" + html);
console.log("เขียน", out, html.length, "ตัวอักษร");
