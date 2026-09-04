// ===== ตั้งค่าร้าน =====
const SHOP_NAME = "QQSHOP";
const PROMPTPAY_PHONE = "0918200409"; // ใช้เบอร์นี้สร้าง QR (ปลอดภัยกว่าเผยแพร่เลขบัตรประชาชน)

// ===== PromptPay QR payload generator (EMV QR มาตรฐานไทย) =====
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
function tlv(id, value) {
  return id + String(value.length).padStart(2, "0") + value;
}
function promptPayPayload(phone, amount) {
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  const target = "0066" + local;
  const merchantInfo = tlv("00", "A000000677010111") + tlv("01", target);
  let payload = "";
  payload += tlv("00", "01");
  payload += tlv("01", amount ? "12" : "11");
  payload += tlv("29", merchantInfo);
  payload += tlv("53", "764");
  if (amount) payload += tlv("54", Number(amount).toFixed(2));
  payload += tlv("58", "TH");
  payload += tlv("59", SHOP_NAME.slice(0, 25));
  payload += tlv("60", "Bangkok");
  payload += "6304";
  return payload + crc16(payload);
}

// ===== Cart (localStorage) =====
const CART_KEY = "omg_cart";
function getCart() { return JSON.parse(localStorage.getItem(CART_KEY) || "{}"); }
function saveCart(cart) { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
function addToCart(id) {
  const cart = getCart();
  cart[id] = (cart[id] || 0) + 1;
  saveCart(cart);
  renderCartBadge();
}
function changeQty(id, delta) {
  const cart = getCart();
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  saveCart(cart);
  renderCartBadge();
  renderCartPanel();
}

let PRODUCTS = [];

async function loadProducts() {
  const res = await fetch("products.json");
  PRODUCTS = await res.json();
  renderProducts();
}

function renderProducts() {
  const grid = document.getElementById("grid");
  grid.innerHTML = PRODUCTS.map(p => `
    <div class="product">
      <div class="emoji">${p.emoji || "🛍️"}</div>
      <h3>${p.name}</h3>
      <div class="desc">${p.desc || ""}</div>
      <div class="price">฿${p.price.toLocaleString()}</div>
      <button onclick="addToCart(${p.id})">เพิ่มลงตะกร้า</button>
    </div>
  `).join("");
}

function renderCartBadge() {
  const cart = getCart();
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  document.getElementById("cart-count").textContent = count;
}

function renderCartPanel() {
  const cart = getCart();
  const list = document.getElementById("cart-list");
  const ids = Object.keys(cart);
  if (ids.length === 0) {
    list.innerHTML = `<div class="empty">ตะกร้าว่างเปล่า</div>`;
    document.getElementById("cart-total-amount").textContent = "฿0";
    return;
  }
  let total = 0;
  list.innerHTML = ids.map(id => {
    const p = PRODUCTS.find(x => x.id == id);
    const qty = cart[id];
    const sub = p.price * qty;
    total += sub;
    return `
      <div class="cart-row">
        <div>${p.emoji || ""} ${p.name}<br><small>฿${p.price} x ${qty}</small></div>
        <div class="qty">
          <button onclick="changeQty(${id}, -1)">-</button>
          <span>${qty}</span>
          <button onclick="changeQty(${id}, 1)">+</button>
        </div>
      </div>`;
  }).join("");
  document.getElementById("cart-total-amount").textContent = "฿" + total.toLocaleString();
}

function openPanel(id) { document.getElementById(id).classList.add("open"); }
function closePanel(id) { document.getElementById(id).classList.remove("open"); }

function openCart() { renderCartPanel(); openPanel("cart-overlay"); }

function openCheckout() {
  const cart = getCart();
  const ids = Object.keys(cart);
  if (ids.length === 0) return;
  let total = 0;
  ids.forEach(id => {
    const p = PRODUCTS.find(x => x.id == id);
    total += p.price * cart[id];
  });
  closePanel("cart-overlay");
  document.getElementById("qr-amount").textContent = "ยอดชำระ ฿" + total.toLocaleString();
  const payload = promptPayPayload(PROMPTPAY_PHONE, total);
  const canvas = document.getElementById("qr-canvas");
  QRCode.toCanvas(canvas, payload, { width: 240 }, function (err) {
    if (err) console.error(err);
  });
  openPanel("checkout-overlay");
}

function clearCartAfterOrder() {
  localStorage.removeItem(CART_KEY);
  renderCartBadge();
  closePanel("checkout-overlay");
  alert("ขอบคุณสำหรับการสั่งซื้อ! หลังโอนเงินแล้วรบกวนแจ้งสลิปกับทางร้านได้เลยค่ะ");
}

document.addEventListener("DOMContentLoaded", () => {
  loadProducts();
  renderCartBadge();
});
