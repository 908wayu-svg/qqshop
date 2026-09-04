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

export function promptPayPayload(phone, amount, shopName = "QQSHOP") {
  const digits = String(phone).replace(/\D/g, "");
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  const merchantInfo = tlv("00", "A000000677010111") + tlv("01", "0066" + local);

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
