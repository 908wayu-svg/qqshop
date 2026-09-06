// ===== กฎเดียวกันที่ถูกเขียนไว้หลายที่ ต้องตรงกันเสมอ =====
// เว็บนี้ไม่มี build step และไฟล์ฝั่งลูกค้าเป็นสคริปต์ธรรมดาบ้าง โมดูลบ้าง
// จึงแชร์โค้ดกันไม่ได้ทุกจุด ผลคือกฎบางข้อถูกคัดลอกไปเขียนซ้ำหลายไฟล์
//
// เคยพลาดมาแล้วจริง: การบีบค่าจำนวนเขียนไว้ 2 ที่ แก้ที่หนึ่งแล้วอีกที่ยังผิดอยู่
// ไฟล์นี้จับ "สำเนาที่หลุดออกจากกัน" ก่อนที่มันจะกลายเป็นบั๊กบนเว็บจริง
import fs from "fs";
import path from "path";
import { SRC } from "./harness.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const read = f => fs.readFileSync(path.join(SRC, f), "utf8");

// =====================================================================
section("เลขที่คำสั่งซื้อ ต้องคิดเหมือนกันทุกหน้า");
// ลูกค้าเห็นเลขนี้ตอนสั่งซื้อ (app.js) และในประวัติ (purchases.js)
// แล้วแจ้งให้แอดมินค้นในหลังบ้าน (admin.js)
// ถ้าสามที่คิดไม่ตรงกัน ลูกค้าแจ้งเลขมาแล้วแอดมินหาไม่เจอ = เถียงกันว่าไม่เคยสั่ง
{
  const files = ["app.js", "purchases.js", "admin.js"];
  const found = {};
  for (const f of files) {
    const m = read(f).match(/slice\(0,\s*8\)\s*\.toUpperCase\(\)/g);
    found[f] = m ? m.length : 0;
  }
  for (const f of files) {
    ok(f + " ใช้สูตรเลขที่คำสั่งซื้อแบบเดียวกัน", found[f] > 0, "ไม่เจอสูตรในไฟล์นี้");
  }
  // ถ้ามีใครเปลี่ยนความยาว จะเหลือไฟล์ที่ยังใช้ 8 ไม่ครบทั้งสาม
  ok("ไม่มีไฟล์ไหนใช้ความยาวอื่น",
    files.every(f => !/slice\(0,\s*(?!8\b)\d+\)\s*\.toUpperCase\(\)/.test(read(f))),
    files.filter(f => /slice\(0,\s*(?!8\b)\d+\)\s*\.toUpperCase\(\)/.test(read(f))).join(", "));
}

// =====================================================================
section("ฟังก์ชันหนีอักขระ ต้องครอบตัวอักษรชุดเดียวกันทุกไฟล์");
// ไฟล์ไหนตกตัวใดตัวหนึ่ง ไฟล์นั้นกลายเป็นช่องยัดสคริปต์ทันที
// (เคยโดนมาแล้วผ่านช่องสลิป — กฎเหล็กข้อ 3)
{
  const files = ["app.js", "purchases.js", "admin.js", "wallet.js"];
  const sets = {};
  for (const f of files) {
    const src = read(f);
    const m = src.match(/replace\(\/\[([^\]]+)\]\/g/);
    sets[f] = m ? m[1] : null;
    // ต้องแปลงครบทั้ง 5 ตัว ไม่ใช่แค่มีนิพจน์
    const map = src.slice(src.indexOf(m ? m[0] : ""), src.indexOf(m ? m[0] : "") + 260);
    const covers = ["&amp;", "&lt;", "&gt;", "&quot;", "&#39;"].every(x => map.includes(x));
    ok(f + " หนีอักขระครบทั้ง 5 ตัว", !!m && covers, sets[f] || "ไม่เจอฟังก์ชัน");
  }
  const uniq = [...new Set(Object.values(sets))];
  ok("ทุกไฟล์ใช้ชุดอักขระเดียวกัน", uniq.length === 1, JSON.stringify(sets));
}

// =====================================================================
section("กลุ่มสถานะออเดอร์ ต้องตรงกันทุกที่");
// ที่ไหนนับ "ขายสำเร็จ" ต้องนับ completed + approved เสมอ (กฎเหล็กในเอกสาร)
// ถ้าไฟล์ไหนตก approved ออกไป ประวัติการขายของออเดอร์เก่าจะหายทั้งก้อน
{
  const want = {
    OPEN_STATES: ["pending", "processing"],
    DONE_STATES: ["completed", "approved"],
    VOID_STATES: ["cancelled", "rejected"],
  };
  const files = ["admin.js", "purchases.js", "auth.js"];
  for (const f of files) {
    const src = read(f);
    for (const [name, list] of Object.entries(want)) {
      const m = src.match(new RegExp("const " + name + "\\s*=\\s*\\[([^\\]]*)\\]"));
      if (!m) continue;   // ไฟล์นั้นไม่ได้ใช้กลุ่มนี้ ไม่เป็นไร
      const got = m[1].split(",").map(x => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      ok(f + " · " + name + " ตรงกับที่ตกลงไว้",
        got.length === list.length && list.every(v => got.includes(v)),
        JSON.stringify(got));
    }
  }

  // ฝั่งเซิร์ฟเวอร์ก็ต้องมองสถานะ "ที่ยังไม่จบ" เหมือนฝั่งหน้าเว็บ
  const worker = read("worker/src/index.js");
  ok("เซิร์ฟเวอร์มองสถานะที่ยังไม่จบเหมือนหน้าเว็บ",
    /\["pending",\s*"processing"\]/.test(worker),
    "ไม่เจอคู่ pending/processing ใน worker");
}

// =====================================================================
section("เวลาเคลม ต้องอ่านจากที่เดียว (shop-config)");
// ตัวเลขนาทีห้ามเขียนตายในโค้ดหน้าไหน ไม่งั้นแก้ที่เดียวแล้วอีกหน้ายังบอกเลขเก่า
{
  for (const f of ["app.js", "purchases.js"]) {
    const src = read(f);
    ok(f + " อ่านเวลาเคลมจาก shop-config", /SHOP\?*\.?policy\?*\.?claimMinutes/.test(src),
      "ไม่เจอการอ่านค่าจาก SHOP.policy.claimMinutes");
  }
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
