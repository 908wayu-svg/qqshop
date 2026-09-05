// ===== ทดสอบตอนโหลดข้อมูลไม่สำเร็จ (เน็ตหลุด / ฐานข้อมูลล่ม) =====
// ทุกหน้าต้องบอกผู้ใช้ ไม่ใช่โชว์หน้าว่างเปล่าให้เดาเอง
import { buildSandbox, makeDom, loadI18n, tick, makeAdmin } from "./harness.mjs";
import { installAdminServer } from "./fake/admin-server.mjs";
import * as store from "./fake/store.mjs";
import * as fs2 from "./fake/firestore.mjs";

const MODE = process.argv[2] || "purchases";
buildSandbox();
makeDom(MODE === "admin" ? "admin.html" : MODE === "wallet" ? "wallet.html" : "purchases.html");
loadI18n();
if (MODE === "wallet") window.QRCode = globalThis.QRCode = function (b) { b.innerHTML = "<canvas></canvas>"; };

const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const $ = id => document.getElementById(id);

await QQ.registerWithEmail(MODE === "admin" ? "908wayu@gmail.com" : "offline@test.com", "secret123", "ผู้ใช้", "");
installAdminServer();
if (MODE === "admin") await makeAdmin(QQ, store);
await tick(6);

// ทำให้การอ่านฐานข้อมูลทุกอย่างล้มเหลว (จำลองเน็ตหลุด)
store.state.failReads = true;

console.log("\n== " + MODE + ": โหลดข้อมูลไม่สำเร็จ ==");
if (MODE === "purchases") {
  await import("./sandbox/purchases.mjs");
  await tick(12);
  ok("ขึ้นข้อความว่าโหลดไม่สำเร็จ", $("list").textContent.includes("โหลดข้อมูลไม่สำเร็จ"), $("list").textContent.trim().slice(0, 80));
  ok("มีปุ่มให้ลองใหม่", $("list").innerHTML.includes("ลองใหม่"));
  ok("หน้าไม่ค้างอยู่ที่ 'กำลังโหลด'", $("gate").classList.contains("hidden"));
} else if (MODE === "wallet") {
  await import("./sandbox/wallet.mjs");
  await tick(12);
  ok("ตารางประวัติบอกว่าโหลดไม่สำเร็จ", $("table-topups").textContent.includes("โหลดข้อมูลไม่สำเร็จ"),
    $("table-topups").textContent.trim().slice(0, 80));
  ok("ส่วนเติมเงินยังใช้ได้อยู่", $("method-grid").querySelectorAll(".method").length > 0);
  ok("หน้าไม่ค้างอยู่ที่ 'กำลังโหลด'", $("gate").classList.contains("hidden"));
} else {
  await import("./sandbox/admin.mjs");
  await tick(14);
  ok("ขึ้นข้อความว่าโหลดไม่สำเร็จ", $("gate").textContent.includes("โหลดข้อมูลไม่สำเร็จ"), $("gate").textContent.trim().slice(0, 80));
  ok("มีปุ่มให้ลองใหม่", $("gate").innerHTML.includes("ลองใหม่"));
  ok("ไม่โชว์แดชบอร์ดเปล่าๆ ให้เข้าใจผิดว่าไม่มีออเดอร์", $("dash").classList.contains("hidden"));
}

store.state.failReads = false;
console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
