// ===== ทดสอบ SEO + การแชร์ลิงก์ =====
// จุดที่พังง่ายและมองไม่เห็นด้วยตา:
//  - เพิ่มหน้าใหม่แล้วลืมใส่ og: / canonical → แชร์ลิงก์ในเฟซบุ๊กแล้วขึ้นเป็นกล่องเปล่า
//  - เผลอ noindex หน้าร้าน → หายจาก Google ทั้งเว็บโดยไม่มีใครรู้
//  - ชี้ไฟล์รูป/ไอคอนที่ไม่มีอยู่จริง → ตัวครอว์เลอร์ดึงรูปไม่ได้ กล่องแชร์ไม่มีรูป
//  - บอกขนาด og:image ผิดจากไฟล์จริง → เฟซบุ๊กครอปรูปมั่ว
import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";
import { SRC } from "./harness.mjs";

const BASE = "https://908wayu-svg.github.io/qqshop/";

// หน้าที่ต้องล็อกอินถึงจะใช้ได้ → ห้ามให้ Google เก็บ
const PAGES = {
  "index.html": { indexable: true },
  "login.html": { indexable: true },
  "privacy.html": { indexable: true },
  "terms.html": { indexable: true },
  "wallet.html": { indexable: false },
  "purchases.html": { indexable: false },
  "admin.html": { indexable: false },
};

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  XX  " + n + (x ? "  -> " + x : ""))); };
const section = s => console.log("\n== " + s + " ==");
const has = f => fs.existsSync(path.join(SRC, f));

// อ่านขนาดรูปจากหัวไฟล์ (ไม่ต้องพึ่งไลบรารีรูปภาพ)
function imageSize(file) {
  const d = fs.readFileSync(path.join(SRC, file));
  if (d[0] === 0x89 && d[1] === 0x50) return { w: d.readUInt32BE(16), h: d.readUInt32BE(20) };
  let i = 2;
  while (i < d.length - 9) {
    if (d[i] !== 0xFF) { i++; continue; }
    const m = d[i + 1];
    if (m >= 0xC0 && m <= 0xC3) return { w: d.readUInt16BE(i + 7), h: d.readUInt16BE(i + 5) };
    i += 2 + d.readUInt16BE(i + 2);
  }
  return null;
}

const docs = {};
for (const p of Object.keys(PAGES)) {
  docs[p] = new JSDOM(fs.readFileSync(path.join(SRC, p), "utf8")).window.document;
}
const meta = (doc, sel) => doc.querySelector(sel)?.getAttribute("content")?.trim() || "";
const og = (doc, prop) => meta(doc, `meta[property="og:${prop}"]`);

section("ทุกหน้าต้องมีชื่อเรื่อง + คำอธิบายของตัวเอง");
for (const [p, cfg] of Object.entries(PAGES)) {
  const doc = docs[p];
  const title = doc.querySelector("title")?.textContent.trim() || "";
  const desc = meta(doc, 'meta[name="description"]');
  ok(p + " มี <title>", title.length > 0);
  ok(p + " ชื่อเรื่องบอกชื่อร้าน", /QQSHOP/i.test(title), title);
  ok(p + " ชื่อเรื่องไม่ยาวเกินจนโดนตัดใน Google", title.length <= 70, title.length + " ตัวอักษร");
  ok(p + " มีคำอธิบายยาวพอ (60-170)", desc.length >= 60 && desc.length <= 170, desc.length + " ตัวอักษร");
  ok(p + " ภาษาหน้าเว็บเป็นไทย", doc.documentElement.getAttribute("lang") === "th");
  void cfg;
}

section("ชื่อเรื่อง/คำอธิบายห้ามซ้ำกันระหว่างหน้า");
for (const key of ["title", "desc"]) {
  const vals = Object.keys(PAGES).map(p => key === "title"
    ? docs[p].querySelector("title").textContent.trim()
    : meta(docs[p], 'meta[name="description"]'));
  ok(key === "title" ? "ชื่อเรื่องไม่ซ้ำ" : "คำอธิบายไม่ซ้ำ",
    new Set(vals).size === vals.length, vals.length - new Set(vals).size + " หน้าซ้ำ");
}

section("canonical ชี้ที่อยู่จริงของแต่ละหน้า");
for (const p of Object.keys(PAGES)) {
  const href = docs[p].querySelector('link[rel="canonical"]')?.getAttribute("href") || "";
  const want = BASE + (p === "index.html" ? "" : p);
  ok(p + " canonical ถูกต้อง", href === want, href || "ไม่มี");
  ok(p + " og:url ตรงกับ canonical", og(docs[p], "url") === want, og(docs[p], "url") || "ไม่มี");
}

section("แชร์ลิงก์ในเฟซบุ๊ก/ไลน์แล้วต้องขึ้นรูป + ชื่อร้าน");
for (const p of Object.keys(PAGES)) {
  const doc = docs[p];
  const title = doc.querySelector("title").textContent.trim();
  const desc = meta(doc, 'meta[name="description"]');
  ok(p + " og:type = website", og(doc, "type") === "website", og(doc, "type"));
  ok(p + " og:site_name = QQSHOP", og(doc, "site_name") === "QQSHOP", og(doc, "site_name"));
  ok(p + " og:locale = th_TH", og(doc, "locale") === "th_TH", og(doc, "locale"));
  ok(p + " og:title ตรงกับชื่อเรื่อง", og(doc, "title") === title);
  ok(p + " og:description ตรงกับคำอธิบาย", og(doc, "description") === desc);
  ok(p + " og:image เป็นลิงก์เต็ม (ครอว์เลอร์ดึงรูปได้)", og(doc, "image").startsWith("https://"), og(doc, "image"));
  ok(p + " twitter:card เป็นรูปใหญ่", meta(doc, 'meta[name="twitter:card"]') === "summary_large_image");
}

section("ไฟล์รูป/ไอคอนที่ประกาศไว้ ต้องมีอยู่จริง");
{
  const referenced = new Set();
  for (const p of Object.keys(PAGES)) {
    const doc = docs[p];
    for (const el of doc.querySelectorAll('link[rel*="icon"]')) referenced.add(el.getAttribute("href"));
    for (const name of ["og:image", "twitter:image"]) {
      const url = doc.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute("content") || "";
      ok(p + " " + name + " อยู่ใต้ที่อยู่เว็บจริง", url.startsWith(BASE), url);
      referenced.add(url.replace(BASE, ""));
    }
  }
  for (const f of referenced) ok("มีไฟล์ " + f, has(f));
}

section("ขนาดรูปแชร์ต้องตรงกับที่บอกไว้ (ไม่งั้นเฟซบุ๊กครอปมั่ว)");
{
  const doc = docs["index.html"];
  const file = og(doc, "image").replace(BASE, "");
  const size = imageSize(file);
  ok("อ่านขนาดไฟล์รูปแชร์ได้", !!size);
  ok("og:image:width ตรงไฟล์จริง", size && String(size.w) === og(doc, "image:width"), size && size.w + " vs " + og(doc, "image:width"));
  ok("og:image:height ตรงไฟล์จริง", size && String(size.h) === og(doc, "image:height"), size && size.h + " vs " + og(doc, "image:height"));
  ok("สัดส่วนรูปใกล้ 1.91:1 ตามที่เฟซบุ๊กใช้", size && Math.abs(size.w / size.h - 1.91) < 0.06,
    size && (size.w / size.h).toFixed(2));
  ok("มีคำบรรยายรูป (og:image:alt)", og(doc, "image:alt").length > 0);
}

section("ไอคอนแท็บเบราว์เซอร์");
for (const p of Object.keys(PAGES)) {
  const doc = docs[p];
  ok(p + " มีไอคอนแบบเวกเตอร์", !!doc.querySelector('link[rel="icon"][type="image/svg+xml"]'));
  ok(p + " มีไอคอน PNG สำรอง (เบราว์เซอร์เก่า)", !!doc.querySelector('link[rel="icon"][type="image/png"]'));
  ok(p + " มีไอคอนตอนบันทึกลงหน้าจอ iPhone", !!doc.querySelector('link[rel="apple-touch-icon"]'));
}
for (const [f, n] of [["favicon-32.png", 32], ["favicon-96.png", 96], ["favicon-180.png", 180]]) {
  const s = imageSize(f);
  ok(f + " ขนาด " + n + "x" + n, !!s && s.w === n && s.h === n, s && s.w + "x" + s.h);
}

section("หน้าที่ต้องล็อกอิน ห้ามโผล่ใน Google / หน้าร้านห้ามโดนบล็อก");
for (const [p, cfg] of Object.entries(PAGES)) {
  const robots = meta(docs[p], 'meta[name="robots"]');
  if (cfg.indexable) ok(p + " เปิดให้ Google เก็บ", !/noindex/.test(robots), robots || "(ไม่มี = เก็บได้)");
  else ok(p + " กันไม่ให้ Google เก็บ", /noindex/.test(robots), robots || "ไม่มี meta robots");
}

section("ข้อมูลร้านสำหรับ Google (JSON-LD)");
{
  const el = docs["index.html"].querySelector('script[type="application/ld+json"]');
  ok("หน้าร้านมี JSON-LD", !!el);
  let data = null;
  try { data = JSON.parse(el.textContent); } catch (e) { ok("JSON-LD อ่านได้ ไม่พัง", false, e.message); }
  if (data) {
    pass++; console.log("  ok  JSON-LD อ่านได้ ไม่พัง");
    const nodes = data["@graph"] || [data];
    const shop = nodes.find(n => /Store|Organization|LocalBusiness/.test(n["@type"] || ""));
    ok("ประกาศ @context เป็น schema.org", data["@context"] === "https://schema.org", data["@context"]);
    ok("มีข้อมูลร้าน", !!shop, (shop && shop["@type"]) || "ไม่เจอ");
    ok("ชื่อร้านถูกต้อง", shop?.name === "QQSHOP", shop?.name);
    ok("ที่อยู่เว็บถูกต้อง", shop?.url === BASE, shop?.url);
    ok("รูปร้านชี้ไฟล์ที่มีอยู่จริง", !!shop?.image && has(shop.image.replace(BASE, "")), shop?.image);
    ok("โลโก้ชี้ไฟล์ที่มีอยู่จริง", !!shop?.logo && has(shop.logo.replace(BASE, "")), shop?.logo);
    ok("มีคำอธิบายร้าน", (shop?.description || "").length >= 30);
    ok("บอกสกุลเงินเป็นบาท", shop?.currenciesAccepted === "THB", shop?.currenciesAccepted);
    ok("มีช่องทางติดต่อ", Array.isArray(shop?.sameAs) && shop.sameAs.length > 0);
    ok("ลิงก์ติดต่อเป็น https ทั้งหมด", (shop?.sameAs || []).every(u => u.startsWith("https://")));
  }
}

section("sitemap.xml");
{
  const raw = fs.readFileSync(path.join(SRC, "sitemap.xml"), "utf8");
  const doc = new JSDOM(raw, { contentType: "text/xml" }).window.document;
  ok("ไฟล์ XML ไม่พัง", doc.querySelectorAll("parsererror").length === 0);
  const locs = [...doc.querySelectorAll("url > loc")].map(n => n.textContent.trim());
  ok("มีรายชื่อหน้าอย่างน้อย 1 หน้า", locs.length > 0);
  ok("มีหน้าร้านเป็นหน้าแรก", locs.includes(BASE), locs[0]);
  for (const loc of locs) {
    ok("อยู่ใต้ที่อยู่เว็บจริง: " + loc, loc.startsWith(BASE));
    const f = loc === BASE ? "index.html" : loc.replace(BASE, "");
    ok("มีไฟล์จริง: " + f, has(f));
    ok("ไม่ใช่หน้าที่สั่ง noindex: " + f, PAGES[f]?.indexable === true);
  }
  ok("วันที่แก้ล่าสุดเป็นรูปแบบ YYYY-MM-DD",
    [...doc.querySelectorAll("lastmod")].every(n => /^\d{4}-\d{2}-\d{2}$/.test(n.textContent.trim())));
}

section("robots.txt");
{
  const txt = fs.readFileSync(path.join(SRC, "robots.txt"), "utf8");
  ok("บอกที่อยู่ sitemap", txt.includes("Sitemap: " + BASE + "sitemap.xml"));
  ok("มี User-agent: *", /^User-agent:\s*\*/m.test(txt));
  for (const [p, cfg] of Object.entries(PAGES)) {
    if (cfg.indexable) continue;
    ok("กันหน้า " + p, txt.includes("Disallow: /qqshop/" + p));
  }
  for (const [p, cfg] of Object.entries(PAGES)) {
    if (!cfg.indexable) continue;
    ok("ไม่เผลอกันหน้า " + p, !txt.includes("Disallow: /qqshop/" + p));
  }
}

console.log("\nสรุป: ผ่าน " + pass + " / ไม่ผ่าน " + fail);
if (fail) process.exitCode = 1;
