// ===== หน้าร้าน: แสดงสินค้า + ตะกร้า + สั่งซื้อด้วยเครดิต =====

const CART_KEY = "qq_cart";
let PRODUCTS = [];

function getCart() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(CART_KEY) || "{}"); }
  catch { return {}; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, qty] of Object.entries(raw)) {
    const n = Math.floor(Number(qty));
    if (Number.isFinite(n) && n > 0 && n <= 999) out[String(id)] = n;
  }
  return out;
}
function saveCart(c) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(c)); }
  catch (e) { console.warn("บันทึกตะกร้าไม่ได้", e); }
}
const findProduct = id => PRODUCTS.find(p => p.id === String(id));

function addToCart(id) {
  const p = findProduct(id);
  if (!p || p.active === false) return;
  const cart = getCart();
  const next = (cart[id] || 0) + 1;
  if (p.stock != null && next > p.stock) return;  // ไม่ให้เกินสต๊อก
  cart[id] = next;
  saveCart(cart);
  renderCartBadge();
}

function changeQty(id, delta) {
  const cart = getCart();
  const p = findProduct(id);
  const next = (cart[id] || 0) + delta;
  if (p?.stock != null && next > p.stock) return;
  if (next <= 0) delete cart[id]; else cart[id] = next;
  saveCart(cart);
  renderCartBadge();
  renderCartPanel();
}

// ทิ้งสินค้าที่ไม่มีอยู่แล้วออกจากตะกร้า (เช่น แอดมินลบสินค้าไปแล้ว)
function pruneCart() {
  const cart = getCart();
  let changed = false;
  Object.keys(cart).forEach(id => {
    const p = findProduct(id);
    if (!p || p.active === false) { delete cart[id]; changed = true; return; }
    if (p.stock != null && cart[id] > p.stock) { cart[id] = Math.max(0, p.stock); changed = true; }
    if (!cart[id]) { delete cart[id]; changed = true; }
  });
  if (changed) saveCart(cart);
  return cart;
}

const cartTotal = cart => Object.entries(cart)
  .reduce((s, [id, qty]) => s + (findProduct(id)?.price || 0) * qty, 0);

// ---------- แสดงผล ----------
// อนุญาตเฉพาะรูปแบบ data: ของจริงเท่านั้น กันสตริงแปลกปลอมหลุดเข้าไปใน src
const safeImg = s =>
  /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(String(s || ""))
    ? String(s) : null;

function productImage(p) {
  // สินค้าเก่ายังฝังรูปไว้ในเอกสาร ต้องรองรับต่อไป
  const img = safeImg(p.image);
  if (img) return `<img class="p-img" src="${img}" alt="${escapeHtml(p.name)}" loading="lazy">`;
  // สินค้าใหม่: ใส่ที่ว่างไว้ก่อน แล้วโหลดรูปตอนเลื่อนมาถึง (img.js)
  if (p.hasImage) {
    return `<img class="p-img lazy" data-pimg="${escapeHtml(p.id)}" src="${window.BLANK_IMG}"
      alt="${escapeHtml(p.name)}" loading="lazy">`;
  }
  return `<div class="emoji">${escapeHtml(p.emoji) || "🛍️"}</div>`;
}

function renderProducts() {
  const grid = document.getElementById("grid");
  const lang = getLang();
  const list = PRODUCTS.filter(p => p.active !== false);

  if (!list.length) { grid.innerHTML = `<div class="empty">${t("no_data")}</div>`; return; }

  grid.innerHTML = list.map(p => {
    const name = (lang === "en" && p.name_en) || p.name;
    const desc = (lang === "en" && p.desc_en) || p.desc || "";
    const soldOut = p.stock != null && p.stock <= 0;
    return `
      <div class="product${soldOut ? " sold-out" : ""}">
        ${productImage(p)}
        <h3>${escapeHtml(name)}</h3>
        <div class="desc">${escapeHtml(desc)}</div>
        <div class="price">${money(p.price)}</div>
        ${p.stock != null && !soldOut ? `<div class="stock">${t("stock_left")} ${p.stock}</div>` : ""}
        ${soldOut
          ? `<button disabled>${t("out_of_stock")}</button>`
          : `<button data-add="${escapeHtml(p.id)}">${t("add_to_cart")}</button>`}
      </div>`;
  }).join("");
  window.watchProductImages?.(grid);
}

function renderCartBadge() {
  const count = Object.values(getCart()).reduce((a, b) => a + b, 0);
  document.getElementById("cart-count").textContent = count;
}

function renderCartPanel() {
  const cart = pruneCart();
  const list = document.getElementById("cart-list");
  const ids = Object.keys(cart);
  const lang = getLang();

  if (!ids.length) {
    list.innerHTML = `<div class="empty">${t("cart_empty")}</div>`;
    document.getElementById("cart-total-amount").textContent = money(0);
  } else {
    list.innerHTML = ids.map(id => {
      const p = findProduct(id);
      const name = (lang === "en" && p.name_en) || p.name;
      return `
        <div class="cart-row">
          <div>${escapeHtml(name)}<br><small>${money(p.price)} × ${cart[id]}</small></div>
          <div class="qty">
            <button data-qty="-1" data-id="${escapeHtml(id)}">−</button>
            <span>${cart[id]}</span>
            <button data-qty="1" data-id="${escapeHtml(id)}">+</button>
          </div>
        </div>`;
    }).join("");
    document.getElementById("cart-total-amount").textContent = money(cartTotal(cart));
  }
  syncCheckoutState();
}

// เปิด/ปิดปุ่มสั่งซื้อ ตามสถานะล็อกอินและเครดิต
function syncCheckoutState() {
  const btn = document.getElementById("cart-checkout");
  const msg = document.getElementById("cart-msg");
  const row = document.getElementById("cart-credit-row");
  if (!btn) return;

  const total = cartTotal(getCart());
  const signedIn = !!window.QQ?.user;
  const credit = window.QQ?.credit || 0;

  row.classList.toggle("hidden", !signedIn);
  document.getElementById("cart-credit").textContent = money(credit);

  const show = (text, kind) => {
    msg.textContent = text;
    msg.className = "msg" + (text ? " show " + kind : "");
  };

  if (total === 0) { btn.disabled = true; show(""); return; }
  if (!signedIn) { btn.disabled = false; show(t("login_required"), "warn"); return; }
  if (credit < total) { btn.disabled = true; show(t("not_enough_credit"), "warn"); return; }
  btn.disabled = false; show("");
}

function openPanel(id) { document.getElementById(id).classList.add("open"); }
function closePanel(id) { document.getElementById(id).classList.remove("open"); }
function openCart() { renderCartPanel(); openPanel("cart-overlay"); }

// ---------- สั่งซื้อ ----------
async function doCheckout() {
  if (!window.QQ?.user) { location.href = "login.html?next=index.html"; return; }
  if (!cartTotal(pruneCart())) return;

  const btn = document.getElementById("cart-checkout");
  btn.disabled = true;
  try {
    // ดึงราคา/สต๊อกล่าสุดก่อนสั่งจริง เผื่อแอดมินแก้ระหว่างที่ลูกค้าเปิดหน้าค้างไว้
    const before = cartTotal(getCart());
    await loadProducts();
    const cart = pruneCart();
    const total = cartTotal(cart);

    if (!total) { renderCartPanel(); return; }
    if (total !== before) {          // ราคาหรือจำนวนเปลี่ยน ให้ลูกค้าเห็นก่อนแล้วค่อยกดใหม่
      renderCartPanel();
      alert(`${t("cart_updated")}\n${t("total")}: ${money(total)}`);
      return;
    }
    if (QQ.credit < total) { syncCheckoutState(); return; }

    const items = Object.entries(cart).map(([id, qty]) => ({ id, qty }));
    const res = await QQ.createOrder(items);

    localStorage.removeItem(CART_KEY);
    renderCartBadge();
    closePanel("cart-overlay");
    alert(`${t("order_placed")}\n\n${t("order_no")}: ${res.orderId.slice(0, 8).toUpperCase()}`);
  } catch (e) {
    // เซิร์ฟเวอร์อาจเจอว่าของหมด/ราคาเปลี่ยน หลังเราเช็คไปแล้ว จึงรีเฟรชให้เห็นของจริง
    const key = "o_" + (e.orderCode || "");
    alert(t(key) === key ? QQ.friendlyError(e) : t(key));
    await loadProducts();
    renderCartPanel();
  } finally {
    btn.disabled = false;
  }
}

// ---------- หัวเว็บ ----------
function syncNav() {
  const user = window.QQ?.user;
  document.getElementById("nav-login")?.classList.toggle("hidden", !!user);
  document.getElementById("nav-logout")?.classList.toggle("hidden", !user);
  document.getElementById("nav-purchases")?.classList.toggle("hidden", !user);
  document.getElementById("nav-admin")?.classList.toggle("hidden", !window.QQ?.isAdmin);
  const chip = document.getElementById("nav-credit");
  if (chip) {
    chip.classList.toggle("hidden", !user);
    document.getElementById("nav-credit-amount").textContent = money(window.QQ?.credit || 0);
  }
  syncCheckoutState();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadProducts() {
  try {
    PRODUCTS = (await QQ.fetchProducts()).map(p => ({ ...p, id: String(p.id) }));
  } catch (e) {
    console.warn("โหลดสินค้าไม่ได้", e);
    PRODUCTS = [];
  }
  renderProducts();
  pruneCart();        // ทิ้งของที่ถูกลบ/เกินสต๊อกก่อนนับตัวเลขบนไอคอนตะกร้า
  renderCartBadge();
}

document.getElementById("grid")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-add]");
  if (btn) addToCart(btn.dataset.add);
});

document.getElementById("cart-list")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-qty]");
  if (btn) changeQty(btn.dataset.id, Number(btn.dataset.qty));
});

document.addEventListener("authchange", syncNav);
document.addEventListener("langchange", () => { renderProducts(); renderCartPanel(); });

document.addEventListener("DOMContentLoaded", async () => {
  renderCartBadge();
  if (window.QQ?.isConfigured) { await QQ.whenAuthReady(); await loadProducts(); }
  syncNav();
});
