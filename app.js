// ===== หน้าร้าน: แสดงสินค้า + ตะกร้า + สั่งซื้อด้วยเครดิต =====

const CART_KEY = "qq_cart";
let PRODUCTS = [];
let ACTIVE_CAT = "all";   // หมวดหมู่ที่เลือกอยู่ตอนนี้ ("all" = ทุกหมวด)

// คำค้น / ช่วงราคา / การเรียงลำดับ — ทำงานร่วมกับแท็บหมวดหมู่ (กรองซ้อนกัน ไม่ใช่แทนที่กัน)
// เก็บไว้ในตัวแปรอย่างเดียว เปิดหน้าใหม่ = เริ่มจากรายการเต็มเสมอ
const FILTERS = { q: "", min: null, max: null, sort: "default" };

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

// ปุ่มแท็บหมวดหมู่เหนือตะแกรงสินค้า — รายชื่อหมวดมาจาก shop-config.js (ผ่าน window.QQ.CATEGORIES)
function renderCatTabs() {
  const box = document.getElementById("cat-tabs");
  if (!box) return;
  const cats = window.QQ?.CATEGORIES || [];
  if (!cats.length) { box.innerHTML = ""; box.classList.add("hidden"); return; }
  // เผื่อสินค้าถูกลบหมวดที่กำลังเลือกอยู่ทิ้งไป กลับไปโชว์ "ทั้งหมด" แทนหน้าว่าง
  if (ACTIVE_CAT !== "all" && !cats.some(c => c.id === ACTIVE_CAT)) ACTIVE_CAT = "all";
  box.classList.remove("hidden");
  const tabs = [{ id: "all", icon: "🗂️" }, ...cats];
  box.innerHTML = tabs.map(c => `
    <button type="button" class="cat-tab${c.id === ACTIVE_CAT ? " active" : ""}" data-cat="${c.id}">
      <span class="cat-ico">${c.icon}</span>${t("cat_" + c.id)}
    </button>`).join("");
}

// ---------- ค้นหา / กรองราคา / เรียงลำดับ ----------
const norm = s => String(s ?? "").trim().toLowerCase();

// พิมพ์หลายคำ = ต้องเจอทุกคำ (พิมพ์ "เพชร 100" แล้วต้องเจอ "เพชร 100 เม็ด")
// ค้นทั้งชื่อและคำอธิบาย ทั้งไทยและอังกฤษ ลูกค้าจะพิมพ์ภาษาไหนก็เจอ
function matchesQuery(p) {
  const q = norm(FILTERS.q);
  if (!q) return true;
  const hay = norm([p.name, p.name_en, p.desc, p.desc_en].join(" "));
  return q.split(/\s+/).every(w => hay.includes(w));
}

function matchesPrice(p) {
  const price = Number(p.price) || 0;
  if (FILTERS.min != null && price < FILTERS.min) return false;
  if (FILTERS.max != null && price > FILTERS.max) return false;
  return true;
}

function sortProducts(list) {
  const lang = getLang();
  const nameOf = p => (lang === "en" && p.name_en) || p.name || "";
  const priceOf = p => Number(p.price) || 0;
  const arr = [...list];
  switch (FILTERS.sort) {
    case "price_asc": return arr.sort((a, b) => priceOf(a) - priceOf(b));
    case "price_desc": return arr.sort((a, b) => priceOf(b) - priceOf(a));
    case "name": return arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b), lang === "en" ? "en" : "th"));
    default: return arr;   // ลำดับที่ร้านจัดไว้ (fetchProducts เรียงมาให้แล้ว)
  }
}

const hasFilters = () => !!FILTERS.q || FILTERS.min != null || FILTERS.max != null;

// ปุ่มกากบาทในช่องค้นหา + ปุ่มล้างตัวกรอง โผล่เฉพาะตอนที่มีอะไรให้ล้างจริงๆ
function syncToolsUI() {
  document.getElementById("q-clear")?.classList.toggle("hidden", !FILTERS.q);
  document.getElementById("clear-filters")?.classList.toggle("hidden",
    !hasFilters() && FILTERS.sort === "default");
}

function renderProducts() {
  const grid = document.getElementById("grid");
  const lang = getLang();
  const inCat = PRODUCTS.filter(p => p.active !== false)
    .filter(p => ACTIVE_CAT === "all" || p.category === ACTIVE_CAT);
  const list = sortProducts(inCat.filter(p => matchesQuery(p) && matchesPrice(p)));

  syncToolsUI();
  const count = document.getElementById("result-count");
  if (count) {
    // ไม่ต้องบอกจำนวนตอนที่ยังไม่ได้กรองอะไรเลย — รกเปล่าๆ
    // อังกฤษต้องใช้ item/items ให้ถูกพจน์ ("Found 1 items" อ่านแล้วสะดุด)
    count.textContent = hasFilters() && list.length
      ? `${t("found_prefix")} ${list.length} ${t(list.length === 1 ? "found_suffix_one" : "found_suffix")}` : "";
  }

  if (!list.length) {
    // แยกให้ชัดว่า "ร้านยังไม่มีของ" กับ "หาไม่เจอเพราะตัวกรอง" คนละเรื่องกัน
    grid.innerHTML = hasFilters()
      ? `<div class="empty">${t("no_match")}
           <div class="hint">${t(FILTERS.min != null && FILTERS.max != null && FILTERS.min > FILTERS.max
              ? "price_range_invalid" : "no_match_hint")}</div>
         </div>`
      : `<div class="empty">${t("no_data")}</div>`;
    return;
  }

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

// ===== ข้อมูลไอดีเกมของลูกค้า (ของเติมเกม) =====
// แอดมินติ๊กไว้ที่สินค้าว่าต้องขออะไร ลูกค้าต้องกรอกให้ครบก่อนถึงจะกดสั่งซื้อได้
// เก็บไว้ในตัวแปร ไม่ใช่ localStorage — รหัสผ่านลูกค้าไม่ควรค้างอยู่ในเครื่อง
const CUSTOMER_INFO = {};
const needsInfo = p => !!(p?.askUid || p?.askLogin);

const infoFieldsOf = p => [
  ...(p?.askUid ? [{ k: "gameUid", label: "your_game_uid" }] : []),
  ...(p?.askLogin ? [{ k: "gameLogin", label: "your_game_login" },
                     { k: "gamePassword", label: "your_game_password" }] : []),
];

function customerInfoFields(p) {
  if (!needsInfo(p)) return "";
  const saved = CUSTOMER_INFO[p.id] || {};
  const rows = infoFieldsOf(p).map(f => `
    <label>${t(f.label)} <span class="req">*</span></label>
    <input type="text" autocomplete="off" spellcheck="false"
           data-info-id="${escapeHtml(p.id)}" data-info-key="${f.k}"
           value="${escapeHtml(saved[f.k] || "")}">`).join("");
  return `<div class="cust-fields">${rows}
    ${p.askLogin ? `<div class="hint warn-note">${t("password_warning")}</div>` : ""}</div>`;
}

// รายการไหนยังกรอกไม่ครบบ้าง
function missingInfo(cart) {
  return Object.keys(cart).filter(id => {
    const p = findProduct(id);
    if (!needsInfo(p)) return false;
    const saved = CUSTOMER_INFO[id] || {};
    return infoFieldsOf(p).some(f => !String(saved[f.k] || "").trim());
  });
}

// ส่งเฉพาะช่องที่สินค้านั้นขอจริง (เซิร์ฟเวอร์ตรวจซ้ำอีกชั้น)
function infoForOrder(id) {
  const p = findProduct(id);
  const saved = CUSTOMER_INFO[id] || {};
  const out = {};
  infoFieldsOf(p).forEach(f => { out[f.k] = String(saved[f.k] || "").trim(); });
  return out;
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
        </div>
        ${customerInfoFields(p)}`;
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
  // ของเติมเกมต้องรู้ไอดีลูกค้าก่อน ไม่งั้นเติมให้ไม่ได้
  if (missingInfo(getCart()).length) { btn.disabled = true; show(t("fill_customer_info"), "warn"); return; }
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

    if (missingInfo(cart).length) { renderCartPanel(); return; }

    const items = Object.entries(cart).map(([id, qty]) => ({ id, qty, ...infoForOrder(id) }));
    const res = await QQ.createOrder(items);

    localStorage.removeItem(CART_KEY);
    // ล้างรหัสผ่านลูกค้าออกจากหน่วยความจำทันทีที่สั่งซื้อเสร็จ
    Object.keys(CUSTOMER_INFO).forEach(k => delete CUSTOMER_INFO[k]);
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

// จำสิ่งที่ลูกค้าพิมพ์ไว้ ไม่งั้นกดเพิ่ม/ลดจำนวนแล้ววาดใหม่ ข้อมูลที่กรอกจะหาย
document.getElementById("cart-list")?.addEventListener("input", e => {
  const el = e.target.closest("[data-info-id]");
  if (!el) return;
  const id = el.dataset.infoId;
  (CUSTOMER_INFO[id] ||= {})[el.dataset.infoKey] = el.value;
  syncCheckoutState();
});

// ---------- แถบค้นหา / กรอง / เรียง ----------
// อ่านค่าจากช่องกรอก: ว่าง/ไม่ใช่ตัวเลข/ติดลบ = ไม่กรอง (null) ไม่ใช่ 0
function readPrice(id) {
  const raw = document.getElementById(id)?.value ?? "";
  if (String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function readFilters() {
  FILTERS.q = document.getElementById("q")?.value ?? "";
  FILTERS.min = readPrice("pmin");
  FILTERS.max = readPrice("pmax");
  FILTERS.sort = document.getElementById("sort")?.value || "default";
  renderProducts();
}

["q", "pmin", "pmax"].forEach(id =>
  document.getElementById(id)?.addEventListener("input", readFilters));
document.getElementById("sort")?.addEventListener("change", readFilters);

document.getElementById("q-clear")?.addEventListener("click", () => {
  const box = document.getElementById("q");
  box.value = "";
  box.focus();
  readFilters();
});

document.getElementById("clear-filters")?.addEventListener("click", () => {
  ["q", "pmin", "pmax"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  const sort = document.getElementById("sort");
  if (sort) sort.value = "default";
  readFilters();
});

document.getElementById("cat-tabs")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-cat]");
  if (!btn || btn.dataset.cat === ACTIVE_CAT) return;
  ACTIVE_CAT = btn.dataset.cat;
  renderCatTabs();
  renderProducts();
});

document.addEventListener("authchange", syncNav);
document.addEventListener("langchange", () => { renderCatTabs(); renderProducts(); renderCartPanel(); });

document.addEventListener("DOMContentLoaded", async () => {
  renderCartBadge();
  renderCatTabs();
  if (window.QQ?.isConfigured) { await QQ.whenAuthReady(); await loadProducts(); }
  syncNav();
});
