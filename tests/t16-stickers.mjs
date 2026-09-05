// ===== ทดสอบสติ๊กเกอร์การ์ตูน: ต้องไม่ทับตัวหนังสือ และปุ่มลอยต้องไม่บังของ =====
// เคยพลาดมาแล้ว: .card ประกาศ padding แบบย่อทีหลัง .empty-box
// padding-top ที่กันที่ไว้ให้รูปเลยโดนล้าง สติ๊กเกอร์จึงทับตัวหนังสือในจอคอม
// เทสต์นี้เช็ค "ค่าที่ได้จริงหลังกฎทับกัน" ไม่ใช่แค่ว่าเขียนกฎไว้หรือยัง
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { SRC } from "./harness.mjs";

const css = fs.readFileSync(path.join(SRC, "style.css"), "utf8");
const flat = css.replace(/\s*\n\s*/g, " ");
const esc = s => s.replace(/[.#]/g, m => "\\" + m);

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const px = v => parseFloat(v) || 0;

// jsdom แกะ background แบบย่อที่มี "/ขนาด" ไม่ออก จึงอ่านความสูงรูปจากตัวไฟล์ CSS เอง
// ส่วน padding-top อ่านจาก jsdom ได้ (ผ่านการทับกันของกฎมาแล้ว)
function stickerHeightOf(selector) {
  const m = flat.match(new RegExp(esc(selector) + "\\{[^}]*girl-1\\.png[^}]*\\}"));
  const size = m && m[0].match(/\/auto (\d+)px/);
  return size ? +size[1] : 0;
}
const styleOf = (markup, id) => {
  const dom = new JSDOM("<style>" + css + "</style>" + markup);
  return dom.window.getComputedStyle(dom.window.document.getElementById(id));
};

section("กล่องว่างหน้าประวัติการซื้อ (.card.empty-box)");
{
  const h = stickerHeightOf(".empty-box");
  const cs = styleOf('<main><div class="card empty-box" id="b">ยังไม่มีประวัติการซื้อ</div></main>', "b");
  ok("มีสติ๊กเกอร์", h > 0, "ความสูงรูป " + h);
  ok("เว้นที่บนพอสำหรับรูป ไม่ทับตัวหนังสือ", px(cs.paddingTop) >= h,
    "padding-top " + cs.paddingTop + " / รูปสูง " + h + "px");
}

section("กล่องว่างหน้าร้าน (#grid .empty)");
{
  const h = stickerHeightOf("#grid .empty");
  const cs = styleOf('<main><div class="grid" id="grid"><div class="empty" id="e">กำลังโหลด...</div></div></main>', "e");
  ok("มีสติ๊กเกอร์", h > 0, "ความสูงรูป " + h);
  ok("เว้นที่บนพอสำหรับรูป ไม่ทับตัวหนังสือ", px(cs.paddingTop) >= h,
    "padding-top " + cs.paddingTop + " / รูปสูง " + h + "px");
  ok("ข้อความกินเต็มความกว้างของตาราง ไม่ถูกบีบเหลือคอลัมน์เดียว",
    cs.gridColumn.replace(/ /g, "") === "1/-1", cs.gridColumn);
}

section("จอมือถือก็ต้องไม่ทับ");
{
  const mob = css.slice(css.indexOf("@media(max-width:600px)")).replace(/\s*\n\s*/g, " ");
  for (const [name, sel] of [["กล่องว่างหน้าร้าน", "#grid .empty"], ["กล่องว่างหน้าประวัติ", ".empty-box"]]) {
    const pt = mob.match(new RegExp(esc(sel) + "\\{[^}]*padding-top:(\\d+)px"));
    const sz = mob.match(new RegExp(esc(sel) + "\\{[^}]*background-size:auto (\\d+)px"));
    ok(name + " ย่อรูปแล้วยังเว้นที่พอ", !!pt && !!sz && +pt[1] >= +sz[1],
      pt && sz ? pt[1] + " / " + sz[1] : "หากฎในจอมือถือไม่เจอ");
  }
}

section(".empty ที่อยู่นอกหน้าร้าน (เช่นในตะกร้า) ไม่ต้องมีรูป");
{
  const cs = styleOf('<div class="panel"><div id="cart-list"><div class="empty" id="e">ตะกร้าว่างเปล่า</div></div></div>', "e");
  ok("ในตะกร้าไม่ต้องเว้นที่ให้รูป", px(cs.paddingTop) < 100, cs.paddingTop);
}

section("มาสคอตหน้าเข้าสู่ระบบ");
ok("ใช้ cat.png บน .auth-main::before", /\.auth-main::before\{[^}]*cat\.png/.test(flat));
ok(".auth-main ตั้ง position ไว้ให้รูปเกาะ", /\.auth-main\{[^}]*position:relative/.test(flat));

section("รูปสติ๊กเกอร์ทุกใบต้องมีอยู่จริง");
for (const f of [...new Set([...css.matchAll(/url\("([^"]+)"\)/g)].map(m => m[1]))]) {
  ok("มีไฟล์ " + f, fs.existsSync(path.join(SRC, f)));
}

section("ปุ่มติดต่อลอย ต้องไม่บังของแถวสุดท้าย");
{
  const markup = '<body class="has-contact-fab"><main id="m">x</main>' +
    '<button class="contact-fab" id="f"><span class="contact-fab-ico">x</span></button>';
  const fab = styleOf(markup, "f"), main = styleOf(markup, "m");
  const need = px(fab.paddingTop) * 2 + px(fab.bottom) + 22;   // สูงปุ่มโดยประมาณ + ระยะห่างขอบล่าง
  ok("หน้าเว้นที่ท้ายหน้าให้ปุ่ม", px(main.paddingBottom) >= need,
    "padding-bottom " + main.paddingBottom + " / ปุ่มกินราว " + need + "px");
  ok("ปุ่มอยู่ต่ำกว่ากล่องลอย", px(fab.zIndex) < 100, fab.zIndex);
}

section("ไม่มี CSS ตายค้างจากรอบใส่สติ๊กเกอร์");
for (const name of [...css.matchAll(/@keyframes ([A-Za-z0-9_-]+)/g)].map(m => m[1])) {
  ok("@keyframes " + name + " มีคนเรียกใช้",
    new RegExp("animation:[^;}]*\\b" + name + "\\b").test(css));
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
