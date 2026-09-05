// ===== ทดสอบด่านกั้นสิทธิ์: สมาชิกธรรมดาเปิดหน้าหลังบ้าน =====
import { buildSandbox, makeDom, loadI18n, tick } from "./harness.mjs";
import * as store from "./fake/store.mjs";

buildSandbox(); makeDom("admin.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const $ = id => document.getElementById(id);

const MODE = process.argv[2] || "member";

if (MODE === "member") {
  await QQ.registerWithEmail("member@test.com", "secret123", "สมาชิกธรรมดา", "");
  await tick(6);
}
await import("./sandbox/admin.mjs");
await tick(10);

if (MODE === "member") {
  console.log("\n== สมาชิกธรรมดาเปิดหน้าหลังบ้าน ==");
  ok("แดชบอร์ดถูกซ่อน", $("dash").classList.contains("hidden"));
  ok("ขึ้นหน้ากั้น", !$("gate").classList.contains("hidden"));
  ok("บอกว่าไม่มีสิทธิ์", $("gate").textContent.includes("สิทธิ์") || $("gate").textContent.includes("ไม่ได้"), $("gate").textContent.trim());
  ok("ไม่มีปุ่มเข้าสู่ระบบ (ล็อกอินอยู่แล้ว)", !$("gate").querySelector("a[href*='login']"));
  ok("ไม่มีข้อมูลลูกค้าคนอื่นรั่วออกมา", !document.body.innerHTML.includes("table-orders>") || $("table-orders").innerHTML === "");
} else {
  console.log("\n== ยังไม่ได้ล็อกอิน เปิดหน้าหลังบ้าน ==");
  ok("แดชบอร์ดถูกซ่อน", $("dash").classList.contains("hidden"));
  ok("ขึ้นหน้ากั้น", !$("gate").classList.contains("hidden"));
  ok("มีปุ่มพาไปเข้าสู่ระบบ", !!$("gate").querySelector("a[href*='login']"));
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
