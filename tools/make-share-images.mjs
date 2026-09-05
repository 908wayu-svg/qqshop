// ===== สร้างรูปแชร์ลิงก์ (og-image.jpg) + ไอคอนเว็บ (favicon-*.png) =====
// ใช้เมื่อเปลี่ยนแบนเนอร์ร้าน (hero-banner.jpg) หรือเปลี่ยนสติ๊กเกอร์แมว (cat.png)
//
// วิธีรัน (ต้องต่อเน็ตครั้งแรกเพื่อโหลดไลบรารีรูปภาพ):
//   cd tools && npm i --no-save jimp && node make-share-images.mjs
//
// ผลลัพธ์เขียนทับไฟล์ในโฟลเดอร์หลัก: og-image.jpg, favicon-32/96/180.png
// (favicon.svg เป็นไฟล์เวกเตอร์ที่เขียนมือ ไม่ได้สร้างจากสคริปต์นี้)
import { Jimp, loadFont, rgbaToInt } from "jimp";
import { SANS_128_WHITE, SANS_32_WHITE } from "jimp/fonts";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- รูปแชร์ลิงก์ 1200x630 (สัดส่วนที่เฟซบุ๊ก/ไลน์ใช้) ----------
async function makeOgImage() {
  const W = 1200, H = 630, BAND = 258;      // BAND = ความสูงแถบส้มด้านบน
  const img = new Jimp({ width: W, height: H, color: 0xfff7ecff });

  // แถบส้ม-ทองไล่สีซ้าย→ขวา
  for (let x = 0; x < W; x++) {
    const t = x / (W - 1);
    const c = rgbaToInt(
      Math.round(0xef + (0xff - 0xef) * t),
      Math.round(0x7c + (0xa8 - 0x7c) * t),
      Math.round(0x17 + (0x2e - 0x17) * t), 255);
    for (let y = 0; y < BAND; y++) img.setPixelColor(c, x, y);
  }

  // แบนเนอร์ร้านเต็มความกว้างด้านล่าง + เส้นคั่นทอง
  const banner = await Jimp.read(`${SRC}/hero-banner.jpg`);
  banner.resize({ w: W });
  img.composite(banner, 0, BAND);
  for (let x = 0; x < W; x++)
    for (let y = BAND; y < BAND + 5; y++) img.setPixelColor(rgbaToInt(0xff, 0xc4, 0x4d, 255), x, y);

  // ชื่อร้าน (ฟอนต์ในไลบรารีไม่มีภาษาไทย จึงใช้อังกฤษ — ชื่อไทยไปโผล่ในข้อความใต้รูปอยู่แล้ว)
  img.print({ font: await loadFont(SANS_128_WHITE), x: 64, y: 40, text: "QQSHOP" });
  img.print({ font: await loadFont(SANS_32_WHITE), x: 70, y: 178,
    text: "GAME ID  /  GAME TOP-UP  /  CREDIT SHOP" });

  // น้องแมวยืนคร่อมแถบกับแบนเนอร์
  const cat = await Jimp.read(`${SRC}/cat.png`);
  cat.resize({ h: 420 });
  img.composite(cat, W - cat.bitmap.width - 70, H - cat.bitmap.height - 30);

  await img.write(`${SRC}/og-image.jpg`, { quality: 80 });
  console.log("og-image.jpg  1200x630");
}

// ---------- ไอคอนเว็บ: หัวน้องแมวบนพื้นส้มมุมมน ----------
async function makeFavicons() {
  const S = 512, R = 112;                    // วาดใหญ่ไว้ก่อนแล้วค่อยย่อ ขอบจะเนียนกว่า
  const icon = new Jimp({ width: S, height: S, color: 0x00000000 });
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const cx = x < R ? R : x > S - R ? S - R : x;
    const cy = y < R ? R : y > S - R ? S - R : y;
    if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;   // ตัดมุมให้มน
    const t = (x + y) / (2 * S);
    icon.setPixelColor(rgbaToInt(
      Math.round(0xff - 0x10 * t), Math.round(0x9d - 0x21 * t), Math.round(0x3c - 0x25 * t), 255), x, y);
  }

  const cat = await Jimp.read(`${SRC}/cat.png`);
  cat.crop({ x: 40, y: 26, w: 264, h: 276 });  // เอาเฉพาะหัว
  cat.resize({ w: 410 });
  icon.composite(cat, Math.round((S - 410) / 2), 42);

  for (const n of [180, 96, 32]) {
    await icon.clone().resize({ w: n, h: n }).write(`${SRC}/favicon-${n}.png`);
    console.log(`favicon-${n}.png  ${n}x${n}`);
  }
}

await makeOgImage();
await makeFavicons();
