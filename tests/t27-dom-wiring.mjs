// ===== ตรวจว่าโค้ดกับหน้าเว็บต่อสายกันถูก =====
// บั๊กกลุ่มนี้ไม่ทำให้หน้าเว็บพัง แต่ปุ่ม/ช่องจะ "กดแล้วไม่เกิดอะไรขึ้น" โดยไม่มีข้อความเตือน
//   - JS ไปหา element ที่ไม่มีอยู่จริง (พิมพ์ id ผิด / ลบออกจาก HTML แต่ลืมลบโค้ด)
//   - id ซ้ำกันในหน้าเดียว (getElementById เจอแค่ตัวแรก อีกตัวใช้ไม่ได้)
//   - ปุ่มที่วาดไว้แต่ไม่มีใครรับคลิก (เคยเกิดกับปุ่มคัดลอกในหลังบ้าน)
import fs from "fs";
import path from "path";
import { SRC } from "./harness.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");

const htmls = fs.readdirSync(SRC).filter(f => f.endsWith(".html") && f !== "google7927e7e3fa345a6c.html");
const idsIn = src => new Set([...src.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

// หน้าไหนโหลดสคริปต์อะไรบ้าง
const pagesOf = {};
const htmlIds = {};
for (const h of htmls) {
  const src = fs.readFileSync(path.join(SRC, h), "utf8");
  htmlIds[h] = idsIn(src);
  for (const m of src.matchAll(/<script[^>]*src="([^"]+\.js)"/g)) {
    const js = m[1].replace(/^\.\//, "");
    if (!js.startsWith("http")) (pagesOf[js] ||= []).push(h);
  }
}

section("JS ต้องไม่ไปหา element ที่ไม่มีอยู่จริง");
// ไฟล์ที่ใช้ร่วมหลายหน้า ตรวจรวมทุกหน้าที่โหลดมัน
for (const [js, pages] of Object.entries(pagesOf)) {
  const code = fs.readFileSync(path.join(SRC, js), "utf8");
  const used = [...code.matchAll(/getElementById\("([^"]+)"\)/g)].map(m => m[1]);
  if (!used.length) continue;
  // element บางตัวถูกสร้างจาก JS เอง (เช่น กล่อง QR, ปุ่มกู้คืนสิทธิ์) จึงนับ id ในโค้ดด้วย
  const madeByJs = new Set([...idsIn(code),
    ...[...code.matchAll(/\.id\s*=\s*"([^"]+)"/g)].map(m => m[1])]);
  const missing = [...new Set(used)].filter(id =>
    !madeByJs.has(id) && !pages.some(p => htmlIds[p].has(id)));
  ok(js + " อ้าง id " + new Set(used).size + " ตัว มีครบทุกตัว", missing.length === 0, missing.join(", "));
}

section("ห้ามมี id ซ้ำในหน้าเดียวกัน");
for (const h of htmls) {
  const all = [...fs.readFileSync(path.join(SRC, h), "utf8").matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const dup = [...new Set(all.filter((v, i) => all.indexOf(v) !== i))];
  ok(h + " ไม่มี id ซ้ำ (" + all.length + " ตัว)", dup.length === 0, dup.join(", "));
}

section("ปุ่มที่วาดไว้ต้องมีคนรับคลิก");
// รวบรวมคลาส/แอตทริบิวต์ของปุ่มที่ JS วาดขึ้นมา แล้วดูว่ามี closest()/querySelector รับไว้ไหม
// (ตรวจเฉพาะรูปแบบที่ใช้จริงในโปรเจกต์นี้ ไม่ได้ตั้งใจให้ครอบจักรวาล)
const jsFiles = fs.readdirSync(SRC).filter(f => f.endsWith(".js"));
const allCode = jsFiles.map(f => fs.readFileSync(path.join(SRC, f), "utf8")).join("\n");
// .cat-tab ผูกคลิกผ่าน [data-cat] อยู่แล้ว จึงไปตรวจในหมวดแอตทริบิวต์แทน
const CLICKABLE = ["copy", "range-btn", "method", "tab"];
// รับได้ทั้ง closest(...) และ closest?.(...) (แบบหลังใช้กันกรณี target ไม่ใช่ element)
const handlerFor = sel => new RegExp('closest\\??\\.?\\(["\']' + sel + '["\']\\)').test(allCode);

for (const cls of CLICKABLE) {
  const drawn = new RegExp('class="[^"]*\\b' + cls + '\\b').test(allCode);
  if (drawn) ok("ปุ่ม ." + cls + " มีตัวรับคลิก", handlerFor("\\." + cls));
}
// ปุ่มที่ผูกด้วยแอตทริบิวต์ data-*
for (const attr of ["data-buy", "data-edit", "data-act", "data-slip", "data-cat", "data-open", "data-copy"]) {
  const drawn = new RegExp(attr + '="').test(allCode);
  // data-copy ผูกคลิกผ่านคลาส .copy ที่ ui.js (ตรวจไปแล้วด้านบน)
  const handled = handlerFor("\\[" + attr + "\\]") || (attr === "data-copy" && handlerFor("\\.copy"));
  if (drawn) ok("ปุ่มที่ใช้ " + attr + " มีตัวรับคลิก", handled);
}

section("ทุกค่าใน data-act ต้องมีคนรับไปทำงานจริง");
// ตัวรับคลิกเป็นก้อน if/else ยาวๆ เทียบ act === "ชื่อ"
// ถ้าพิมพ์ชื่อไม่ตรงกันสักตัว ปุ่มนั้นจะกดแล้วเงียบสนิท ไม่มี error ให้เห็น
{
  const drawn = new Set();
  for (const m of allCode.matchAll(/data-act="([a-z-]+)"/g)) drawn.add(m[1]);
  // บางปุ่มประกอบชื่อจากตัวแปร (เช่น "hide-" ต่อด้วยชนิดของรายการ)
  // ดึงชื่อเต็มไม่ได้ จึงเก็บส่วนหน้าไว้เทียบแบบ "ขึ้นต้นด้วย" แทน
  const prefixes = [...allCode.matchAll(/data-act="([a-z-]+)-\${/g)].map(m => m[1]);

  const handled = new Set();
  for (const m of allCode.matchAll(/act === "([a-z-]+)"/g)) handled.add(m[1]);

  const orphans = [...drawn].filter(v => !handled.has(v)
    && !prefixes.some(pre => v.startsWith(pre + "-")));
  ok("ไม่มีปุ่ม data-act ที่ไม่มีใครรับ", orphans.length === 0, orphans.join(", "));

  // ทางกลับกัน: โค้ดที่รอรับชื่อซึ่งไม่มีใครวาดแล้ว = โค้ดตาย ลบทิ้งได้
  // บางปุ่มวาดผ่านตัวช่วย (เช่น btn("approve-order", ...)) จึงไม่โผล่เป็น data-act ตรงๆ
  // ถือว่า "ยังมีคนวาด" ถ้าชื่อนั้นถูกเขียนเป็นสตริงที่อื่นในโค้ดด้วย ไม่ใช่แค่ในตัวรับคลิก
  const usedElsewhere = v =>
    allCode.split(JSON.stringify(v)).length - 1 > 1;
  const deadArms = [...handled].filter(v => !drawn.has(v)
    && !prefixes.some(pre => v.startsWith(pre + "-"))
    && !usedElsewhere(v));
  ok("ไม่มีโค้ดรับปุ่มที่ไม่มีอยู่แล้ว", deadArms.length === 0, deadArms.join(", "));
}

section("ป้ายกำกับต้องผูกกับช่องกรอก (โปรแกรมอ่านหน้าจอ)");
// ถ้าป้ายไม่ได้ผูกกับช่อง คนที่ใช้โปรแกรมอ่านหน้าจอจะได้ยินแค่ "ช่องว่าง"
// ไม่รู้ว่าต้องกรอกอะไร — หน้าเข้าสู่ระบบกับหน้าเติมเงินสำคัญที่สุด
for (const h of htmls) {
  const src = fs.readFileSync(path.join(SRC, h), "utf8");
  const orphan = [];
  // อ่านทั้งแท็ก (แอตทริบิวต์อาจอยู่คนละบรรทัด) แล้วดูว่ามีอะไรบอกชื่อช่องบ้าง
  for (const m of src.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)) {
    const tag = m[0];
    const idm = tag.match(/\bid="([^"]+)"/);
    if (!idm) continue;
    if (/type="(hidden|checkbox|radio|file)"/.test(tag)) continue;
    const id = idm[1];
    const hasLabel = src.includes(`for="${id}"`);
    // placeholder/title/aria-label ก็อ่านออกเสียงได้ (ป้ายจริงดีที่สุด แต่พอใช้ได้)
    const selfDescribed = /aria-label=|data-i18n-placeholder=|data-i18n-title=/.test(tag);
    if (!hasLabel && !selfDescribed) orphan.push(id);
  }
  ok(h + " ช่องกรอกมีป้ายผูกครบ", orphan.length === 0, orphan.join(", "));
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
