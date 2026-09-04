// ===== หน้าร้าน: แสดงสินค้า + ตะกร้า + สั่งซื้อด้วยเครดิต =====

const CART_KEY = "qq_cart";
let PRODUCTS = [];

const getCart = () => JSON.parse(localStorage.getItem(CART_KEY) || "{}");
const saveCart = c => localStorage.setItem(CART_KEY, JSON.stringify(c));
const findProduct = id => PRODUCTS.find(p => p.id === String(id));

function addToCart(id) {
  const p = findProduct(id);
  if (!p) return;
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
    if (!p) { delete cart[id]; changed = true; }
    else if (p.stock != null && cart[id] > p.stock) { cart[id] = p.stock; changed = true; }
    if (cart[id] === 0) delete cart[id];
  });
  if (changed) saveCart(cart);
  return cart;
}

const cartTotal = cart => Object.entries(cart)
  .reduce((s, [id, qty]) => s + (findProduct(id)?.price || 0) * qty, 0);

// ---------- แสดงผล ----------
function productImage(p) {
  return p.image
    ? `<img class="p-img" src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy">`
    : `<div class="emoji">${p.emoji || "🛍️"}</div>`;
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
          : `<button onclick="addToCart('${p.id}')">${t("add_to_cart")}</button>`}
      </div>`;
  }).join("");
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
            <button onclick="changeQty('${id}', -1)">−</button>
            <span>${cart[id]}</span>
            <button onclick="changeQty('${id}', 1)">+</button>
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
  const cart = pruneCart();
  const total = cartTotal(cart);
  if (!total) return;

  if (!window.QQ?.user) { location.href = "login.html?next=index.html"; return; }
  if (QQ.credit < total) return;

  const btn = document.getElementById("cart-checkout");
  btn.disabled = true;
  try {
    const items = Object.entries(cart).map(([id, qty]) => {
      const p = findProduct(id);
      return { id, name: p.name, price: p.price, qty };
    });
    const ref = await QQ.createOrder({ items, total });
    localStorage.removeItem(CART_KEY);
    renderCartBadge();
    closePanel("cart-overlay");
    alert(`${t("order_placed")}\n\n${t("order_no")}: ${ref.id.slice(0, 8).toUpperCase()}`);
  } catch (e) {
    alert(QQ.friendlyError(e));
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
  renderCartBadge();
}

document.addEventListener("authchange", syncNav);
document.addEventListener("langchange", () => { renderProducts(); renderCartPanel(); });

document.addEventListener("DOMContentLoaded", async () => {
  renderCartBadge();
  if (window.QQ?.isConfigured) { await QQ.whenAuthReady(); await loadProducts(); }
  syncNav();
});
