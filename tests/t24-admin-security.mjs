// ===== ทดสอบเจาะช่องโหว่: เครดิต / สิทธิ์แอดมิน =====
// จำลองคนร้ายที่ดัดแปลงหน้าเว็บแล้วยิงคำสั่งเข้าฐานข้อมูลตรงๆ
// ทุกข้อในไฟล์นี้คือสิ่งที่ "ต้องทำไม่ได้" ถ้าข้อไหนผ่านได้ = ช่องโหว่จริง
import { buildSandbox, makeDom, loadI18n, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";
import { installAdminServer, BOOTSTRAP_SECRET, handleAdmin, handleOrder } from "./fake/admin-server.mjs";

buildSandbox(); makeDom("index.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");

// "ต้องทำไม่ได้" — ถ้าไม่ error แปลว่าหลุด
const denied = async (fn, n) => {
  try { await fn(); ok(n, false, "ทำสำเร็จทั้งที่ต้องถูกปฏิเสธ"); }
  catch (e) { ok(n, true); return e; }
};
const allowed = async (fn, n) => {
  try { await fn(); ok(n, true); }
  catch (e) { ok(n, false, e.message); }
};
// ยิงเส้นทางเซิร์ฟเวอร์ตรงๆ แล้วดูรหัสที่ตอบกลับ
const call = (path, uid, body = {}) => handleAdmin(path, { idToken: "token:" + uid, ...body });
const callOrder = (path, uid, body = {}) => handleOrder(path, { idToken: "token:" + uid, ...body });
const errOf = r => (r.data && r.data.error) || "";

const db = fs2.getFirestore();
const OWNER = "908wayu@gmail.com";
const CUST = "cust@test.com";

installAdminServer();

// ---------- ตั้งบัญชี ----------
await QQ.registerWithEmail(OWNER, "adminpass", "เจ้าของร้าน", "0918200409");
await tick(5);
const ADMIN_UID = QQ.user.uid;
await QQ.bootstrapAdmin(BOOTSTRAP_SECRET);
await tick(3);

await QQ.registerWithEmail(CUST, "custpass", "ลูกค้า", "0800000000");
await tick(5);
const CUST_UID = QQ.user.uid;
store.state.docs.set("users/" + CUST_UID, { ...store.raw("users/" + CUST_UID), credit: 500 });

// เหยื่ออีกคน (ไม่ได้ล็อกอิน) ใช้ทดสอบการยุ่งกับบัญชีคนอื่น
store.put("users/victim", {
  uid: "victim", email: "victim@test.com", name: "เหยื่อ",
  role: "member", credit: 9000, createdAt: new fs2.Timestamp(Date.now()),
});

// ================================================================
section("ลูกค้าแก้เครดิต/สิทธิ์ของตัวเองผ่านเบราว์เซอร์");
// ตอนนี้ล็อกอินอยู่เป็นลูกค้า
await denied(() => fs2.updateDoc(fs2.doc(db, "users", CUST_UID), { credit: 999999 }),
  "ลูกค้าเติมเครดิตให้ตัวเองไม่ได้");
await denied(() => fs2.updateDoc(fs2.doc(db, "users", CUST_UID), { role: "admin" }),
  "ลูกค้าตั้งตัวเองเป็นแอดมินไม่ได้");
await denied(() => fs2.updateDoc(fs2.doc(db, "users", CUST_UID), { email: "someone@else.com" }),
  "ลูกค้าแก้อีเมลตัวเองไม่ได้");
await denied(() => fs2.updateDoc(fs2.doc(db, "users", CUST_UID), { name: "ปกติ", credit: 1 }),
  "แอบพ่วง credit มากับการแก้ชื่อไม่ได้");
await denied(() => fs2.updateDoc(fs2.doc(db, "users", CUST_UID), { name: "x".repeat(200) }),
  "ยัดชื่อยาวเกินขนาดไม่ได้");
await allowed(() => fs2.updateDoc(fs2.doc(db, "users", CUST_UID), { name: "ชื่อใหม่", phone: "0811111111" }),
  "แก้ชื่อกับเบอร์ของตัวเองได้ตามปกติ");
ok("เครดิตยังเท่าเดิมหลังพยายามทุกทาง", store.raw("users/" + CUST_UID).credit === 500,
  String(store.raw("users/" + CUST_UID).credit));

section("ลูกค้ายุ่งกับบัญชีคนอื่น");
await denied(() => fs2.updateDoc(fs2.doc(db, "users", "victim"), { credit: 0 }),
  "แก้เครดิตคนอื่นไม่ได้");
await denied(() => fs2.getDoc(fs2.doc(db, "users", "victim")),
  "อ่านโปรไฟล์คนอื่นไม่ได้");
await denied(() => fs2.deleteDoc(fs2.doc(db, "users", "victim")),
  "ลบบัญชีคนอื่นไม่ได้");

section("ลูกค้าสร้างเอกสารสมาชิกปลอม");
await denied(() => fs2.setDoc(fs2.doc(db, "users", "fake1"),
  { uid: "fake1", email: CUST, name: "x", phone: "", provider: "email", role: "member", credit: 0 }),
  "สร้างเอกสารของ uid อื่นไม่ได้");
// เอกสารของตัวเองถูกสร้างไปแล้ว จึงทดสอบเงื่อนไขผ่านการ "สร้างทับ" ที่ต้องถูกปฏิเสธเช่นกัน
await denied(() => fs2.setDoc(fs2.doc(db, "users", CUST_UID),
  { uid: CUST_UID, email: CUST, name: "x", phone: "", provider: "email", role: "admin", credit: 0 }),
  "สร้างเอกสารตัวเองด้วย role admin ไม่ได้");
await denied(() => fs2.setDoc(fs2.doc(db, "users", CUST_UID),
  { uid: CUST_UID, email: CUST, name: "x", phone: "", provider: "email", role: "member", credit: 5000 }),
  "สร้างเอกสารตัวเองพร้อมเครดิตติดตัวไม่ได้");
await denied(() => fs2.setDoc(fs2.doc(db, "users", CUST_UID),
  { uid: CUST_UID, email: "owner@fake.com", name: "x", phone: "", provider: "email", role: "member", credit: 0 }),
  "สร้างเอกสารด้วยอีเมลที่ไม่ใช่ของตัวเองไม่ได้");
await denied(() => fs2.setDoc(fs2.doc(db, "users", CUST_UID),
  { uid: CUST_UID, email: CUST, name: "x", phone: "", provider: "email", role: "member", credit: 0, banned: false }),
  "แนบฟิลด์แปลกปลอมตอนสมัครไม่ได้");

section("ลูกค้ายุ่งกับออเดอร์/เติมเงิน/คลังสินค้าโดยตรง");
store.put("products/p1", { name: "ไอดีเกม", price: 100, stock: 5, active: true, digital: true });
store.put("products/p1/stockItems/s1", { login: "u1", password: "pw1", status: "available", sort: 1 });
store.put("orders/oVictim", { uid: "victim", items: [], total: 50, status: "pending",
  createdAt: new fs2.Timestamp(Date.now()) });
store.put("topups/tCust", { uid: CUST_UID, amount: 100, method: "bank", hasSlip: true,
  status: "pending", createdAt: new fs2.Timestamp(Date.now()) });

await denied(() => fs2.setDoc(fs2.doc(db, "orders", "hack1"),
  { uid: CUST_UID, items: [], total: 1, status: "approved" }),
  "สร้างออเดอร์เองไม่ได้ (ต้องผ่านเซิร์ฟเวอร์)");
await denied(() => fs2.updateDoc(fs2.doc(db, "topups", "tCust"), { status: "approved" }),
  "กดอนุมัติเติมเงินของตัวเองไม่ได้");
await denied(() => fs2.updateDoc(fs2.doc(db, "topups", "tCust"), { amount: 99999 }),
  "แก้ยอดเติมเงินที่ยื่นไปแล้วไม่ได้");
await denied(() => fs2.setDoc(fs2.doc(db, "topups", "fakeTop"),
  { uid: CUST_UID, amount: 5000, method: "bank", hasSlip: true, status: "approved" }),
  "สร้างรายการเติมเงินสถานะอนุมัติแล้วไม่ได้");
await denied(() => fs2.getDoc(fs2.doc(db, "products", "p1", "stockItems", "s1")),
  "อ่านรหัสผ่านในคลังไม่ได้");
await denied(() => fs2.getDoc(fs2.doc(db, "orders", "oVictim")),
  "อ่านออเดอร์ของคนอื่นไม่ได้");
await denied(() => fs2.getDoc(fs2.doc(db, "adminLogs", "log1")),
  "ลูกค้าอ่านบันทึกของแอดมินไม่ได้");

section("ลูกค้ายิงเส้นทางแอดมินที่เซิร์ฟเวอร์");
ok("ลูกค้ายิง /admin/credit ไม่ผ่าน", errOf(call("/admin/credit", CUST_UID,
  { uid: CUST_UID, amount: 10000 })) === "ADMIN_ONLY");
ok("ลูกค้ายิง /admin/role ตั้งตัวเองไม่ผ่าน", errOf(call("/admin/role", CUST_UID,
  { uid: CUST_UID, makeAdmin: true })) === "ADMIN_ONLY");
ok("ลูกค้ายิง /admin/order/approve ไม่ผ่าน", errOf(call("/admin/order/approve", CUST_UID,
  { orderId: "oVictim" })) === "ADMIN_ONLY");
// ปุ่มชุดใหม่ของออเดอร์ (เริ่ม/เสร็จ/ยกเลิกคืนเครดิต) ต้องกันเหมือนกันทุกเส้นทาง
// ปุ่มยกเลิกอันตรายที่สุด เพราะมันเพิ่มเครดิตให้คนอื่นได้
ok("ลูกค้ายิง /admin/order/start ไม่ผ่าน", errOf(call("/admin/order/start", CUST_UID,
  { orderId: "oVictim" })) === "ADMIN_ONLY");
ok("ลูกค้ายิง /admin/order/complete ไม่ผ่าน", errOf(call("/admin/order/complete", CUST_UID,
  { orderId: "oVictim" })) === "ADMIN_ONLY");
ok("ลูกค้ายิง /admin/order/cancel (คืนเครดิต) ไม่ผ่าน", errOf(call("/admin/order/cancel", CUST_UID,
  { orderId: "oVictim" })) === "ADMIN_ONLY");
ok("ลูกค้ายิง /admin/bootstrap ด้วยรหัสมั่วไม่ผ่าน", errOf(call("/admin/bootstrap", CUST_UID,
  { secret: "aaaaaaaaaaaaaaaaaaaa" })) === "BOOTSTRAP_BAD_SECRET");
ok("เครดิตลูกค้าไม่ขยับเลยหลังยิงทุกทาง", store.raw("users/" + CUST_UID).credit === 500);

// ================================================================
section("สิทธิ์ต้องครบ 2 ชั้น: claim + เอกสาร");
// ชั้นเดียว: มี claim แต่เอกสารเป็น member (เช่นโทเคนเก่าค้างหลังถูกถอนสิทธิ์)
store.setClaims(CUST_UID, { admin: true });
await QQ.refreshClaims();
ok("มี claim อย่างเดียว = หน้าเว็บยังไม่ให้เป็นแอดมิน (เอกสารไม่ใช่ admin)",
  store.raw("users/" + CUST_UID).role !== "admin");
await denied(() => fs2.getDoc(fs2.doc(db, "users", "victim")),
  "มี claim อย่างเดียว อ่านข้อมูลคนอื่นไม่ได้");
await denied(() => fs2.getDoc(fs2.doc(db, "products", "p1", "stockItems", "s1")),
  "มี claim อย่างเดียว อ่านคลังรหัสผ่านไม่ได้");
ok("มี claim อย่างเดียว ยิงเส้นทางแอดมินไม่ผ่าน", errOf(call("/admin/credit", CUST_UID,
  { uid: CUST_UID, amount: 1 })) === "ADMIN_ONLY");

// ชั้นเดียวอีกแบบ: เอกสารเป็น admin แต่ไม่มี claim
store.setClaims(CUST_UID, {});
store.state.docs.set("users/" + CUST_UID, { ...store.raw("users/" + CUST_UID), role: "admin" });
await QQ.refreshClaims();
ok("เอกสารเป็น admin แต่ไม่มี claim = ยังไม่ใช่แอดมิน", QQ.isAdmin === false);
await denied(() => fs2.getDoc(fs2.doc(db, "users", "victim")),
  "เอกสารอย่างเดียว อ่านข้อมูลคนอื่นไม่ได้");
ok("เอกสารอย่างเดียว ยิงเส้นทางแอดมินไม่ผ่าน", errOf(call("/admin/credit", CUST_UID,
  { uid: CUST_UID, amount: 1 })) === "ADMIN_ONLY");

// คืนสภาพลูกค้าให้เป็นสมาชิกธรรมดา
store.state.docs.set("users/" + CUST_UID, { ...store.raw("users/" + CUST_UID), role: "member" });
store.setClaims(CUST_UID, {});
await QQ.refreshClaims();

// ================================================================
section("แอดมินตัวจริงก็แก้เครดิต/สิทธิ์ผ่านเบราว์เซอร์ไม่ได้");
await QQ.logout(); await tick(3);
await QQ.loginWithEmail(OWNER, "adminpass"); await tick(5);
ok("เจ้าของร้านกลับมาเป็นแอดมิน", QQ.isAdmin === true);

await denied(() => fs2.updateDoc(fs2.doc(db, "users", "victim"), { credit: 99999 }),
  "แอดมินเติมเครดิตให้คนอื่นผ่าน Firestore ตรงๆ ไม่ได้");
await denied(() => fs2.updateDoc(fs2.doc(db, "users", ADMIN_UID), { credit: 99999 }),
  "แอดมินเติมเครดิตให้ตัวเองไม่ได้");
await denied(() => fs2.updateDoc(fs2.doc(db, "users", "victim"), { role: "admin" }),
  "แอดมินตั้งสิทธิ์คนอื่นผ่าน Firestore ตรงๆ ไม่ได้");
await denied(() => fs2.updateDoc(fs2.doc(db, "orders", "oVictim"), { status: "approved" }),
  "แอดมินแก้ออเดอร์ตรงๆ ไม่ได้");
await denied(() => fs2.updateDoc(fs2.doc(db, "topups", "tCust"), { status: "approved" }),
  "แอดมินอนุมัติเติมเงินตรงๆ ไม่ได้");
await denied(() => fs2.setDoc(fs2.doc(db, "topups", "adminFake"),
  { uid: "victim", amount: 1, method: "admin", status: "approved" }),
  "แอดมินสร้างรายการเติมเงินปลอมไม่ได้");
await denied(() => fs2.setDoc(fs2.doc(db, "adminLogs", "x1"), { action: "ปลอม" }),
  "แอดมินเขียนบันทึกปลอมไม่ได้");
await denied(() => fs2.deleteDoc(fs2.doc(db, "adminLogs", "log1")),
  "แอดมินลบบันทึกของตัวเองไม่ได้");
ok("เครดิตเหยื่อไม่ขยับ", store.raw("users/victim").credit === 9000);

section("สิ่งที่แอดมินยังทำได้ตามปกติ");
await allowed(() => fs2.getDoc(fs2.doc(db, "users", "victim")), "อ่านข้อมูลสมาชิกได้");
await allowed(() => fs2.getDoc(fs2.doc(db, "products", "p1", "stockItems", "s1")), "อ่านคลังสินค้าได้");
await allowed(() => fs2.setDoc(fs2.doc(db, "products", "p2"), { name: "ของใหม่", price: 10, active: true }),
  "เพิ่ม/แก้สินค้าได้");
await allowed(() => fs2.updateDoc(fs2.doc(db, "users", "victim"), { name: "แก้ชื่อให้ลูกค้า" }),
  "แก้ชื่อสมาชิกให้ได้ (ไม่ใช่เครดิต/สิทธิ์)");
await allowed(() => fs2.getDoc(fs2.doc(db, "orders", "oVictim")), "อ่านออเดอร์ของทุกคนได้");

section("ปรับเครดิตผ่านเซิร์ฟเวอร์ (ทางเดียวที่เหลือ)");
await allowed(() => QQ.adjustCredit("victim", 100, "ทดสอบ"), "แอดมินปรับเครดิตผ่านเซิร์ฟเวอร์ได้");
ok("เครดิตขยับตามจริง", store.raw("users/victim").credit === 9100,
  String(store.raw("users/victim").credit));
ok("ยอด 0 ปรับไม่ได้", errOf(call("/admin/credit", ADMIN_UID,
  { uid: "victim", amount: 0 })) === "AMOUNT_INVALID");
ok("ยอดเกินเพดานต่อครั้งไม่ได้", errOf(call("/admin/credit", ADMIN_UID,
  { uid: "victim", amount: 200000 })) === "AMOUNT_TOO_LARGE");
ok("หักจนเครดิตติดลบไม่ได้", errOf(call("/admin/credit", ADMIN_UID,
  { uid: "victim", amount: -50000 })) === "WOULD_GO_NEGATIVE");
ok("ปรับให้สมาชิกที่ไม่มีอยู่จริงไม่ได้", errOf(call("/admin/credit", ADMIN_UID,
  { uid: "ไม่มีคนนี้", amount: 10 })) === "BAD_REQUEST");
ok("เครดิตยังเป็นยอดเดิมหลังคำสั่งที่ล้มเหลว", store.raw("users/victim").credit === 9100);

section("ตั้ง/ถอดสิทธิ์แอดมิน");
ok("ถอดสิทธิ์ตัวเองไม่ได้", errOf(call("/admin/role", ADMIN_UID,
  { uid: ADMIN_UID, makeAdmin: false })) === "CANNOT_CHANGE_SELF");
ok("ตั้งสิทธิ์ให้ตัวเองซ้ำก็ไม่ได้", errOf(call("/admin/role", ADMIN_UID,
  { uid: ADMIN_UID, makeAdmin: true })) === "CANNOT_CHANGE_SELF");
await allowed(() => QQ.setRole(CUST_UID, "admin"), "ตั้งสมาชิกคนอื่นเป็นแอดมินได้");
ok("ตั้งแล้ว claim ถูกใส่ให้", store.claimsOf(CUST_UID).admin === true);
ok("ตั้งแล้วเอกสารเป็น admin ด้วย", store.raw("users/" + CUST_UID).role === "admin");
await allowed(() => QQ.setRole(CUST_UID, "member"), "ถอดสิทธิ์สมาชิกคนอื่นได้");
ok("ถอนแล้ว claim ถูกล้าง", store.claimsOf(CUST_UID).admin !== true);
ok("ถอนแล้วเอกสารกลับเป็น member", store.raw("users/" + CUST_UID).role === "member");

section("กันกดซ้ำ / กดสวนกัน (ผ่านเซิร์ฟเวอร์)");
store.put("topups/tt1", { uid: "victim", amount: 200, method: "bank", hasSlip: true,
  status: "pending", createdAt: new fs2.Timestamp(Date.now()) });
await allowed(() => QQ.approveTopup("tt1"), "อนุมัติเติมเงินได้");
ok("เครดิตเข้าครั้งเดียว", store.raw("users/victim").credit === 9300);
ok("อนุมัติซ้ำไม่ได้", errOf(call("/admin/topup/approve", ADMIN_UID,
  { topupId: "tt1" })) === "ALREADY_HANDLED");
ok("กดไม่อนุมัติทับของที่อนุมัติแล้วไม่ได้", errOf(call("/admin/topup/reject", ADMIN_UID,
  { topupId: "tt1" })) === "ALREADY_HANDLED");
ok("เครดิตไม่เข้าซ้ำ", store.raw("users/victim").credit === 9300);
ok("รายการยอด 0 อนุมัติไม่ผ่าน", (() => {
  store.put("topups/tt0", { uid: "victim", amount: 0, method: "angpao",
    status: "pending", createdAt: new fs2.Timestamp(Date.now()) });
  return errOf(call("/admin/topup/approve", ADMIN_UID, { topupId: "tt0" })) === "AMOUNT_MISSING";
})());

section("ทุกการกระทำของแอดมินถูกบันทึกไว้");
const logs = [...store.state.docs.entries()].filter(([k]) => k.startsWith("adminLogs/")).map(([, v]) => v);
ok("มีบันทึกการปรับเครดิต", logs.some(l => l.action === "credit.adjust" && l.amount === 100));
ok("มีบันทึกการตั้งสิทธิ์", logs.some(l => l.action === "role.grant" && l.targetUid === CUST_UID));
ok("มีบันทึกการถอนสิทธิ์", logs.some(l => l.action === "role.revoke" && l.targetUid === CUST_UID));
ok("มีบันทึกการอนุมัติเติมเงิน", logs.some(l => l.action === "topup.approve" && l.topupId === "tt1"));
ok("มีบันทึกตอนตั้งแอดมินคนแรก", logs.some(l => l.action === "role.bootstrap"));
ok("บันทึกมีชื่อคนทำทุกใบ", logs.every(l => !!l.byUid));
ok("บันทึกมียอดก่อน/หลังของรายการเงิน",
  logs.filter(l => l.action === "credit.adjust" || l.action === "topup.approve")
      .every(l => typeof l.before === "number" && typeof l.after === "number"));
await allowed(() => fs2.getDoc(fs2.doc(db, "adminLogs", "log1")), "แอดมินอ่านบันทึกได้");

section("สคริปต์จากเว็บนอกต้องตรึงเวอร์ชัน + ตรวจลายเซ็นไฟล์");
{
  // เว็บนี้รับเงินจริง ถ้า CDN ถูกแฮกแล้วสลับไฟล์สคริปต์
  // คนร้ายเปลี่ยน QR/เลขบัญชีที่โชว์ให้ลูกค้าโอนได้เลย — integrity ปิดทางนี้
  const fsNode = await import("fs");
  const pathNode = await import("path");
  const { SRC: ROOT } = await import("./harness.mjs");
  const files = fsNode.readdirSync(ROOT).filter(f => /\.(html|js)$/.test(f));
  const problems = [];
  for (const f of files) {
    const src = fsNode.readFileSync(pathNode.join(ROOT, f), "utf8");
    // แท็กสคริปต์ในไฟล์ HTML
    for (const m of src.matchAll(/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"[^>]*>/g)) {
      if (!/\bintegrity=/.test(m[0])) problems.push(f + " → ไม่มี integrity: " + m[1]);
      if (!/\d+\.\d+\.\d+/.test(m[1])) problems.push(f + " → ไม่ได้ตรึงเวอร์ชัน: " + m[1]);
    }
    // สคริปต์ที่โหลดเองจาก JS (เช่น ตัวอ่านสลิป)
    for (const m of src.matchAll(/\.src\s*=\s*"(https?:\/\/[^"]+\.js)"/g)) {
      if (!/\.integrity\s*=/.test(src)) problems.push(f + " → โหลดสคริปต์เองแต่ไม่ตั้ง integrity: " + m[1]);
      if (!/\d+\.\d+\.\d+/.test(m[1])) problems.push(f + " → ไม่ได้ตรึงเวอร์ชัน: " + m[1]);
    }
  }
  ok("ทุกสคริปต์ภายนอกตรึงเวอร์ชันและมีลายเซ็นครบ", problems.length === 0, problems.join(" · "));
}

// ================================================================
section("เส้นทางสั่งซื้อของลูกค้า — สิ่งที่ต้องทำไม่ได้");
{
  store.put("products/pOrd", { name: "ของทดสอบ", price: 100, stock: 5, active: true, askUid: true });
  // ออเดอร์ของเหยื่อ ที่ยังแก้ข้อมูลได้ (สถานะรอดำเนินการ)
  store.put("orders/oEdit", { uid: "victim", total: 100, status: "pending", paid: true, kind: "topup",
    createdAt: new fs2.Timestamp(Date.now()),
    items: [{ id: "pOrd", name: "ของทดสอบ", price: 100, qty: 1, gameUid: "ของเหยื่อ" }] });

  // 1) แก้ออเดอร์คนอื่นไม่ได้ และต้องไม่บอกใบ้ว่ามีออเดอร์นี้อยู่จริง
  ok("แก้ข้อมูลในออเดอร์ของคนอื่นไม่ได้",
    errOf(callOrder("/order/edit-info", CUST_UID,
      { orderId: "oEdit", items: [{ index: 0, gameUid: "โดนแก้" }] })) === "ORDER_NOT_FOUND");
  ok("ข้อมูลของเหยื่อไม่ถูกแตะ", store.raw("orders/oEdit").items[0].gameUid === "ของเหยื่อ");

  // 2) เขียนทับ orders ตรงๆ ผ่านเบราว์เซอร์ไม่ได้ (กฎ Firestore ปิดไว้)
  await denied(() => fs2.updateDoc(fs2.doc(db, "orders", "oEdit"), { status: "completed" }),
    "เปลี่ยนสถานะออเดอร์เองผ่านเบราว์เซอร์ไม่ได้");

  // 3) ออเดอร์ของตัวเอง แก้ได้เฉพาะช่องที่สินค้าขอ ห้ามแตะราคา/จำนวน/ยอดรวม
  store.put("orders/oMine", { uid: CUST_UID, total: 100, status: "pending", paid: true, kind: "topup",
    createdAt: new fs2.Timestamp(Date.now()),
    items: [{ id: "pOrd", name: "ของทดสอบ", price: 100, qty: 1, gameUid: "111" }] });
  callOrder("/order/edit-info", CUST_UID,
    { orderId: "oMine", items: [{ index: 0, gameUid: "222", qty: 999, price: 1 }] });
  const mine = store.raw("orders/oMine");
  ok("แก้ช่องที่สินค้าขอได้ตามปกติ", mine.items[0].gameUid === "222");
  ok("แก้จำนวนในออเดอร์ตัวเองไม่ได้", mine.items[0].qty === 1, String(mine.items[0].qty));
  ok("แก้ราคาในออเดอร์ตัวเองไม่ได้", mine.items[0].price === 100, String(mine.items[0].price));
  ok("ยอดรวมไม่ขยับ", mine.total === 100);

  // 4) เพิ่มช่องที่สินค้าไม่ได้ขอเข้ามาใหม่ไม่ได้ (กันยัดรหัสผ่านมั่วเข้าออเดอร์)
  callOrder("/order/edit-info", CUST_UID,
    { orderId: "oMine", items: [{ index: 0, gamePassword: "แอบยัด" }] });
  ok("เพิ่มช่องที่สินค้าไม่ได้ขอไม่ได้", !store.raw("orders/oMine").items[0].gamePassword);

  // 5) พอแอดมินเริ่มดำเนินการแล้ว ต้องล็อกทันที
  store.put("orders/oMine", { ...store.raw("orders/oMine"), status: "processing" });
  ok("แอดมินเริ่มแล้ว ลูกค้าแก้ไม่ได้อีก",
    errOf(callOrder("/order/edit-info", CUST_UID,
      { orderId: "oMine", items: [{ index: 0, gameUid: "333" }] })) === "EDIT_LOCKED");
  ok("ค่ายังเป็นค่าล่าสุดก่อนล็อก", store.raw("orders/oMine").items[0].gameUid === "222");

  // 6) สั่งซื้อเกินเครดิตไม่ได้ และห้ามเหลือออเดอร์ค้างไว้
  store.put("products/pRich", { name: "ของแพง", price: 100000, stock: 5, active: true });
  const before = store.raw("users/" + CUST_UID).credit;
  const ordersBefore = [...store.state.docs.keys()].filter(k => k.startsWith("orders/")).length;
  ok("สั่งซื้อเกินเครดิตที่มีไม่ได้",
    errOf(callOrder("/order", CUST_UID, { items: [{ id: "pRich", qty: 1 }] })) === "NOT_ENOUGH_CREDIT");
  ok("เครดิตไม่ขยับหลังสั่งไม่ผ่าน", store.raw("users/" + CUST_UID).credit === before,
    String(store.raw("users/" + CUST_UID).credit));
  ok("ไม่มีออเดอร์ค้างไว้",
    [...store.state.docs.keys()].filter(k => k.startsWith("orders/")).length === ordersBefore);
  ok("สต๊อกไม่ถูกตัดตอนสั่งไม่ผ่าน", store.raw("products/pRich").stock === 5);

}

// ================================================================
section("สคริปต์จากเว็บนอกต้องตรึงเวอร์ชัน + ตรวจลายเซ็นไฟล์");
{
  // เว็บนี้รับเงินจริง ถ้า CDN ถูกแฮกแล้วสลับไฟล์สคริปต์
  // คนร้ายเปลี่ยน QR/เลขบัญชีที่โชว์ให้ลูกค้าโอนได้เลย — integrity ปิดทางนี้
  const fsNode = await import("fs");
  const pathNode = await import("path");
  const { SRC: ROOT } = await import("./harness.mjs");
  const files = fsNode.readdirSync(ROOT).filter(f => /\.(html|js)$/.test(f));
  const problems = [];
  for (const f of files) {
    const src = fsNode.readFileSync(pathNode.join(ROOT, f), "utf8");
    // แท็กสคริปต์ในไฟล์ HTML
    for (const m of src.matchAll(/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"[^>]*>/g)) {
      if (!/\bintegrity=/.test(m[0])) problems.push(f + " → ไม่มี integrity: " + m[1]);
      if (!/\d+\.\d+\.\d+/.test(m[1])) problems.push(f + " → ไม่ได้ตรึงเวอร์ชัน: " + m[1]);
    }
    // สคริปต์ที่โหลดเองจาก JS (เช่น ตัวอ่านสลิป)
    for (const m of src.matchAll(/\.src\s*=\s*"(https?:\/\/[^"]+\.js)"/g)) {
      if (!/\.integrity\s*=/.test(src)) problems.push(f + " → โหลดสคริปต์เองแต่ไม่ตั้ง integrity: " + m[1]);
      if (!/\d+\.\d+\.\d+/.test(m[1])) problems.push(f + " → ไม่ได้ตรึงเวอร์ชัน: " + m[1]);
    }
  }
  ok("ทุกสคริปต์ภายนอกตรึงเวอร์ชันและมีลายเซ็นครบ", problems.length === 0, problems.join(" · "));
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
