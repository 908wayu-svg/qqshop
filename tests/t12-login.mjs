// ===== ทดสอบหน้าเข้าสู่ระบบ / สมัครสมาชิก =====
import fs from "fs";
import { buildSandbox, makeDom, loadI18n, tick, SRC } from "./harness.mjs";
import * as store from "./fake/store.mjs";

buildSandbox(); const dom = makeDom("login.html"); loadI18n();
const { QQ } = await import("./sandbox/auth.mjs");
globalThis.QQ = QQ;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const $ = id => document.getElementById(id);

// สคริปต์ในหน้า login เป็นสคริปต์ธรรมดาฝังในไฟล์ HTML
const html = fs.readFileSync(SRC + "/login.html", "utf8");
// เอาเฉพาะสคริปต์ก้อนสุดท้ายก่อน </body> (หน้านี้มีสคริปต์ตั้งโหมดมืดอยู่ใน <head> ด้วย)
// เงื่อนไข (?!<\/script>) กันไม่ให้จับข้ามก้อนไปรวมกับ HTML ที่คั่นอยู่ตรงกลาง
const inline = html.match(/<script>((?:(?!<\/script>)[\s\S])*)<\/script>\s*<\/body>/)[1];
// jsdom เปลี่ยนหน้าไม่ได้ จึงดักเฉพาะบรรทัดที่พาไปหน้าถัดไป (ที่เหลือเป็นโค้ดจริงทั้งหมด)
const patched = inline.replace(
  `location.href = NEXT_ALLOWED.includes(next) ? next : "index.html";`,
  `globalThis.__nav = NEXT_ALLOWED.includes(next) ? next : "index.html";`);
if (patched === inline) throw new Error("หาบรรทัดเปลี่ยนหน้าในหน้า login ไม่เจอ");
const api = new Function(patched + "\n;return { showTab, setMsg, afterLogin, doLogin, doRegister, doGoogle, doReset, guard };")();
Object.assign(globalThis, api);
for (const [k, v] of Object.entries(api)) window[k] = v;

globalThis.__nav = null;
const navSeen = () => globalThis.__nav;

section("สลับแท็บ");
window.showTab("register");
ok("แสดงฟอร์มสมัคร", !$("form-register").classList.contains("hidden"));
ok("ซ่อนฟอร์มเข้าสู่ระบบ", $("form-login").classList.contains("hidden"));
window.showTab("login");
ok("กลับมาแท็บเข้าสู่ระบบได้", !$("form-login").classList.contains("hidden"));

section("สมัครสมาชิก");
const ev = { preventDefault() {} };
$("reg-name").value = "สมหญิง ทดสอบ";
$("reg-email").value = "signup@test.com";
$("reg-phone").value = "0891234567";
$("reg-password").value = "12345";
window.doRegister(ev);
await tick(4);
ok("รหัสสั้นเกินไปถูกเตือน", $("msg").textContent.includes("6"), $("msg").textContent);
ok("ยังไม่ได้สมัคร", !QQ.user);

$("reg-password").value = "secret123";
window.doRegister(ev);
await tick(8);
ok("สมัครสำเร็จ", !!QQ.user, "user = " + QQ.user?.email);
ok("พาไปหน้าถัดไป", navSeen() !== null, String(navSeen()));
const doc = store.raw("users/" + QQ.user.uid);
ok("ชื่อที่กรอกถูกบันทึก", doc?.name === "สมหญิง ทดสอบ", "ได้ " + doc?.name);
ok("เบอร์ที่กรอกถูกบันทึก", doc?.phone === "0891234567", "ได้ " + doc?.phone);
ok("เริ่มต้นเป็นสมาชิกธรรมดา", doc?.role === "member");
ok("เริ่มต้นเครดิต 0", doc?.credit === 0);

section("สมัครด้วยอีเมลซ้ำ");
await QQ.logout(); await tick(4);
globalThis.__nav = null;
window.showTab("register");
$("reg-name").value = "คนที่สอง";
$("reg-email").value = "signup@test.com";
$("reg-phone").value = "";
$("reg-password").value = "secret123";
window.doRegister(ev);
await tick(8);
ok("เตือนว่าอีเมลถูกใช้แล้ว", $("msg").textContent.includes("ถูกใช้"), $("msg").textContent);
ok("ไม่พาไปไหน", navSeen() === null, String(navSeen()));

section("เข้าสู่ระบบ");
window.showTab("login");
$("login-email").value = "signup@test.com";
$("login-password").value = "ผิดแน่นอน";
window.doLogin(ev);
await tick(8);
ok("รหัสผิดถูกเตือน", $("msg").textContent.includes("ไม่ถูกต้อง"), $("msg").textContent);
ok("ปุ่มกลับมากดได้", $("tab-login").disabled === false);

$("login-password").value = "secret123";
window.doLogin(ev);
await tick(8);
ok("เข้าสู่ระบบสำเร็จ", !!QQ.user);
ok("พาไปหน้าถัดไป", navSeen() !== null, String(navSeen()));

section("ลืมรหัสผ่าน");
await QQ.logout(); await tick(4);
$("login-email").value = "";
window.doReset();
await tick(4);
ok("ไม่กรอกอีเมล = เตือน", $("msg").textContent.includes("อีเมล"), $("msg").textContent);
$("login-email").value = "ไม่มีบัญชีนี้@test.com";
window.doReset();
await tick(8);
ok("ไม่พบบัญชี = เตือน", $("msg").textContent.includes("ไม่พบ"), $("msg").textContent);
$("login-email").value = "signup@test.com";
window.doReset();
await tick(8);
ok("ส่งลิงก์รีเซ็ตได้", $("msg").className.includes("ok"), $("msg").textContent);

section("เข้าสู่ระบบด้วย Google");
globalThis.__nav = null;
window.doGoogle();
await tick(10);
ok("เข้าสู่ระบบด้วย Google ได้", !!QQ.user);
ok("บันทึกว่าเป็นบัญชี Google", store.raw("users/" + QQ.user.uid)?.provider === "google");
ok("พาไปหน้าถัดไป", navSeen() !== null, String(navSeen()));

section("กดปุ่มรัวๆ ไม่สมัครซ้อน");
await QQ.logout(); await tick(4);
window.showTab("register");
$("reg-name").value = "กดรัว";
$("reg-email").value = "spam@test.com";
$("reg-phone").value = "";
$("reg-password").value = "secret123";
window.doRegister(ev); window.doRegister(ev); window.doRegister(ev);
await tick(12);
const spam = [...store.state.docs.keys()].filter(k => k.startsWith("users/"));
const dupes = spam.filter(k => store.raw(k).email === "spam@test.com");
ok("สร้างบัญชีเดียว ไม่ซ้อน", dupes.length === 1, "ได้ " + dupes.length);
ok("ปุ่มกลับมากดได้หลังเสร็จ", $("tab-login").disabled === false);

section("ลิงก์เด้งต่อหลังล็อกอิน (?next=) ต้องพาไปได้เฉพาะหน้าในเว็บเรา");
// เคยเป็นช่องโหว่: เอาค่าจาก ?next= ไปใช้ตรงๆ คนร้ายส่งลิงก์ที่พาลูกค้าไปเว็บปลอม
// ที่ทำหน้าตาเหมือนกันแล้วหลอกเอารหัสผ่านซ้ำได้ (open redirect)
const goTo = q => {
  window.history.replaceState({}, "", "/qqshop/login.html" + q);
  globalThis.__nav = null;
  window.afterLogin();
  return globalThis.__nav;
};
ok("หน้าปกติในเว็บเรา ไปได้ตามเดิม", goTo("?next=purchases.html") === "purchases.html", goTo("?next=purchases.html"));
ok("หน้าหลังบ้านก็ยังไปได้", goTo("?next=admin.html") === "admin.html");
ok("ไม่ใส่ next มาเลย = กลับหน้าร้าน", goTo("") === "index.html");
for (const bad of [
  "https://เว็บปลอม.example/login",
  "//เว็บปลอม.example",
  "http://evil.example",
  "javascript:alert(1)",
  "/qqshop/../../etc/passwd",
  "index.html.evil.example",
]) {
  ok("กันลิงก์นอกเว็บ: " + bad, goTo("?next=" + encodeURIComponent(bad)) === "index.html",
    goTo("?next=" + encodeURIComponent(bad)));
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
