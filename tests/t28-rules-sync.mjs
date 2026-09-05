// ===== กฎจริง (firestore.rules) กับกฎจำลองในเทส (fake/store.mjs) ต้องตรงกัน =====
// เทสทั้งชุดตัดสินเรื่องสิทธิ์จากกฎจำลอง ถ้ากฎจำลองล้าสมัยเมื่อไหร่
// เทสจะ "ผ่านหมด" ทั้งที่ของจริงอาจเปิดช่องไว้ — อันตรายกว่าเทสตกอีก
import fs from "fs";
import path from "path";
import { SRC } from "./harness.mjs";
import * as store from "./fake/store.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");

const rules = fs.readFileSync(path.join(SRC, "firestore.rules"), "utf8");

// ---------- อ่านคอลเลกชันทั้งหมดที่กฎจริงพูดถึง ----------
// "databases" คือบรรทัดครอบไฟล์ (match /databases/{database}/documents) ไม่ใช่คอลเลกชันจริง
const collections = [...rules.matchAll(/match\s+\/([a-zA-Z]+)\/\{/g)]
  .map(m => m[1]).filter(c => c !== "databases");
const uniqueCols = [...new Set(collections)];

section("คอลเลกชันในกฎจริงต้องมีในกฎจำลองครบ");
ok("อ่านกฎจริงเจอ " + uniqueCols.length + " คอลเลกชัน", uniqueCols.length >= 7, uniqueCols.join(", "));

const fakeSrc = fs.readFileSync(path.join(SRC, "tests/fake/store.mjs"), "utf8");
for (const col of uniqueCols) {
  ok("กฎจำลองพูดถึง " + col, fakeSrc.includes('"' + col + '"'), col);
}

// ---------- คำสั่งที่กฎจริงปิดตายไว้ (if false) กฎจำลองต้องปิดด้วย ----------
section("คำสั่งที่ปิดตายในกฎจริง ต้องปิดในกฎจำลองเหมือนกัน");
// ตัดไฟล์เป็นบล็อกต่อคอลเลกชัน แล้วหาเฉพาะบรรทัด allow ... : if false;
const denied = [];
for (const m of rules.matchAll(/match\s+\/([a-zA-Z]+)\/\{[^{]*\{([\s\S]*?)\n    \}/g)) {
  const [, col, body] = m;
  for (const a of body.matchAll(/allow\s+([a-z,\s]+):\s*if\s+false\s*;/g)) {
    a[1].split(",").map(s => s.trim()).filter(Boolean).forEach(op => denied.push([col, op]));
  }
}
ok("เจอคำสั่งที่ปิดตายในกฎจริง " + denied.length + " รายการ", denied.length >= 4,
  denied.map(d => d.join(":")).join(" · "));

// เตรียมสถานะจำลอง: ผู้ใช้ที่เป็นแอดมินเต็มตัว (claim + เอกสาร) — ระดับสิทธิ์สูงสุดที่เบราว์เซอร์มีได้
store.reset();
store.state.user = { uid: "adm1", email: "admin@x.com" };
store.setClaims("adm1", { admin: true });
store.put("users/adm1", { uid: "adm1", email: "admin@x.com", role: "admin", credit: 0 });
const sample = { uid: "adm1", amount: 1, status: "approved", method: "bank", hasSlip: true, slip: "x" };
store.put("orders/o1", sample);
store.put("topups/t1", sample);
store.put("topupSlips/s1", sample);
store.put("adminLogs/l1", { action: "x" });

for (const [col, op] of denied) {
  const path2 = col + "/" + (col === "orders" ? "o1" : col === "topups" ? "t1"
    : col === "topupSlips" ? "s1" : col === "adminLogs" ? "l1" : "x1");
  // op "write" ในกฎครอบคลุม create/update/delete
  const ops = op === "write" ? ["create", "update", "delete"] : [op];
  for (const o of ops) {
    const allowed = store.can(o, path2, sample, sample);
    ok("แม้แต่แอดมินก็ " + o + " " + col + " ไม่ได้", allowed === false, "กฎจำลองยอมให้ทำ");
  }
}

// ---------- ฟิลด์ที่ห้ามแตะเด็ดขาด ----------
section("credit / role ต้องแก้จากเบราว์เซอร์ไม่ได้ทั้งในกฎจริงและกฎจำลอง");
ok("กฎจริงจำกัดการแก้ users ไว้แค่ name/phone",
  /affectedKeys\(\)\.hasOnly\(\['name',\s*'phone'\]\)/.test(rules), "หาบรรทัดจำกัดฟิลด์ไม่เจอ");
const before = { uid: "adm1", email: "admin@x.com", role: "admin", credit: 0, name: "a", phone: "1" };
ok("กฎจำลอง: แอดมินแก้ credit ของตัวเองไม่ได้",
  store.can("update", "users/adm1", { ...before, credit: 999 }, before) === false);
ok("กฎจำลอง: แอดมินแก้ role ของคนอื่นไม่ได้", (() => {
  store.put("users/u2", { uid: "u2", email: "u2@x.com", role: "member", credit: 0 });
  const b = store.raw("users/u2");
  return store.can("update", "users/u2", { ...b, role: "admin" }, b) === false;
})());
ok("กฎจำลอง: แก้ชื่อ/เบอร์ยังทำได้ตามปกติ",
  store.can("update", "users/adm1", { ...before, name: "ชื่อใหม่" }, before) === true);

// ---------- สิทธิ์แอดมินต้องครบ 2 ชั้นทั้งสองที่ ----------
section("สิทธิ์แอดมินต้องใช้ทั้ง custom claim และเอกสาร");
ok("กฎจริงเช็ค custom claim", /request\.auth\.token\.get\('admin',\s*false\)\s*==\s*true/.test(rules));
ok("กฎจริงเช็ค role ในเอกสารด้วย", /\.data\.get\('role',\s*''\)\s*==\s*'admin'/.test(rules));
ok("กฎจริงไม่เหลือรายชื่ออีเมลแอดมินแล้ว", !/ownerEmails|@gmail\.com/.test(rules),
  "ยังมีอีเมลฝังอยู่ในกฎ");
ok("กฎจำลองเช็ค claim", /claimsOf\(state\.user\.uid\)\.admin\s*!==\s*true/.test(fakeSrc));
ok("กฎจำลองเช็ค role ในเอกสาร", /u\.role\s*===\s*"admin"/.test(fakeSrc));

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
