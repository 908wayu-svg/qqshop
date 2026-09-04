// ===== ตั้งค่าร้าน / ช่องทางรับเงิน =====
// แก้ไขข้อมูลตรงนี้ได้เลย ไม่ต้องแตะไฟล์อื่น

export const SHOP = {
  name: "QQSHOP",

  // ช่องทางเติมเงินที่เปิดใช้ (ปิดช่องทางไหน เปลี่ยน enabled เป็น false)
  channels: {
    // ทรูมันนี่ วอลเล็ต — โอนเข้าเบอร์นี้ แล้วแนบสลิป
    truewallet: {
      enabled: true,
      phone: "0918200409",
      accountName: "วายุ พลศิริ",
    },

    // ซองอั่งเปา ทรูมันนี่ — ลูกค้าวางลิงก์แล้วกดส่ง ระบบกดรับเข้าเบอร์นี้ให้อัตโนมัติ
    angpao: {
      enabled: true,
      receivePhone: "0918200409",
      // ที่อยู่ของบอทรับซอง (Cloudflare Worker)
      // ปล่อยว่าง = ปิดระบบอัตโนมัติ กลับไปใช้แบบส่งให้แอดมินกดรับเอง
      botUrl: "https://qqshop-angpao-bot.qqshop-angpao-bot.workers.dev",
    },

    // โอนผ่านธนาคาร — แนบสลิป
    bank: {
      enabled: true,
      bankName: "ธนาคารกสิกรไทย",
      bankNameEn: "Kasikornbank (KBank)",
      accountNo: "1811180633",
      accountName: "วายุ พลศิริ",
    },

    // พร้อมเพย์ QR — สร้าง QR อัตโนมัติจากเบอร์นี้
    promptpay: {
      enabled: true,
      phone: "0918200409",
    },
  },

  // จำนวนเงินขั้นต่ำ/สูงสุดต่อการเติม 1 ครั้ง
  topup: { min: 1, max: 100000 },
};

// ดึงรหัสซองอั่งเปาออกจากลิงก์ (รองรับหลายรูปแบบลิงก์ของทรูมันนี่)
export function parseAngpaoCode(link) {
  if (!link) return null;
  const m = String(link).match(/[?&]v=([A-Za-z0-9]+)/)
    || String(link).match(/campaign\/\?v=([A-Za-z0-9]+)/)
    || String(link).match(/^([A-Za-z0-9]{16,})$/);
  return m ? m[1] : null;
}

// ลิงก์สำหรับให้แอดมินกดรับซอง (เปิดในแอป/เว็บทรูมันนี่ด้วยเบอร์ผู้รับ)
export function angpaoRedeemUrl(link) {
  const code = parseAngpaoCode(link);
  return code ? `https://gift.truemoney.com/campaign/?v=${code}` : link;
}
