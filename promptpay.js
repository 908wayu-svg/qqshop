// ===== สร้าง payload พร้อมเพย์ (EMV QR มาตรฐานไทย) =====

function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

const tlv = (id, value) => id + String(value.length).padStart(2, "0") + value;

// แปลงสิ่งที่เจ้าของร้านกรอก เป็นช่องข้อมูลผู้รับตามมาตรฐานพร้อมเพย์
// รองรับทั้ง 0918200409 / 66918200409 / +66 91-820-0409 / เลขบัตรประชาชน 13 หลัก
// คืนค่า null ถ้าอ่านไม่ออก — ดีกว่าสร้าง QR ที่พาลูกค้าโอนเข้าบัญชีผิด
export function promptPayTarget(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;

  // เลขบัตรประชาชน 13 หลัก (แต่ 0066xxxxxxxxx ก็ 13 หลักเหมือนกัน ต้องแยกให้ออก)
  if (digits.length === 13 && !digits.startsWith("0066")) return { tag: "02", value: digits };

  let local = digits;
  if (local.startsWith("0066")) local = local.slice(4);
  else if (local.startsWith("66") && local.length === 11) local = local.slice(2);
  else if (local.startsWith("0") && local.length === 10) local = local.slice(1);

  // เบอร์มือถือไทยตัดศูนย์หน้าแล้วต้องเหลือ 9 หลักเสมอ
  return local.length === 9 ? { tag: "01", value: "0066" + local } : null;
}

export function promptPayPayload(phone, amount, shopName = "QQSHOP") {
  const target = promptPayTarget(phone);
  if (!target) return null;
  const merchantInfo = tlv("00", "A000000677010111") + tlv(target.tag, target.value);

  let payload = "";
  payload += tlv("00", "01");
  payload += tlv("01", amount ? "12" : "11");
  payload += tlv("29", merchantInfo);
  payload += tlv("53", "764");
  if (amount) payload += tlv("54", Number(amount).toFixed(2));
  payload += tlv("58", "TH");
  payload += tlv("59", shopName.slice(0, 25));
  payload += tlv("60", "Bangkok");
  payload += "6304";
  return payload + crc16(payload);
}
