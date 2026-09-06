// ===== หน้าร้าน: แสดงสินค้า + สั่งซื้อทันทีด้วยเครดิต =====
// ไม่มีตะกร้าแล้ว — กด "สั่งซื้อ" ที่การ์ดสินค้าแล้วเปิดหน้าต่างสั่งซื้อของชิ้นนั้นเลย
// เครดิตถูกหักทันทีที่กดยืนยัน (เซิร์ฟเวอร์เป็นคนหัก ไม่ใช่เบราว์เซอร์ — กฎเหล็กข้อ 1-2)

let PRODUCTS = [];
let ACTIVE_CAT = "all";   // หมวดหมู่ที่เลือกอยู่ตอนนี้ ("all" = ทุกหมวด)

// คำค้น / ช่วงราคา / การเรียงลำดับ — ทำงานร่วมกับแท็บหมวดหมู่ (กรองซ้อนกัน ไม่ใช่แทนที่กัน)
// เก็บไว้ในตัวแปรอย่างเดียว เปิดหน้าใหม่ = เริ่มจากรายการเต็มเสมอ
const FILTERS = { q: "", min: null, max: null, sort: "default" };

// รายการที่กำลังจะซื้ออยู่ตอนนี้ (null = ยังไม่ได้เปิดหน้าต่างสั่งซื้อ)
// info เก็บไว้ในตัวแปร ไม่ใช่ localStorage — รหัสผ่านลูกค้าไม่ควรค้างอยู่ในเครื่อง
let BUY = null;   // { id, qty, info: {}, accepted, busy }

const findProduct = id => PRODUCTS.find(p => p.id === String(id));

// เงื่อนไขเคลมมาจาก shop-config.js ที่เดียว (SHOP.policy) — หน้าเว็บทุกจุดใช้ค่าเดียวกัน
const claimMinutes = () => Number(window.QQ?.SHOP?.policy?.claimMinutes) || 10;

// ---------- แสดงผล ----------
// อนุญาตเฉพาะรูปแบบ data: ของจริงเท่านั้น กันสตริงแปลกปลอมหลุดเข้าไปใน src
const safeImg = s =>
  /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(String(s || ""))
    ? String(s) : null;

function productImage(p) {
  // สินค้าเก่ายังฝังรูปไว้ในเอกสาร ต้องรองรับต่อไป
  const img = safeImg(p.image);
  if (img) return `<img class="p-img" src="${img}" alt="${escapeHtml(p.name)}" loading="lazy">`;
  // สินค้าใหม่: ใส่ที่ว่างไว้ก่อน แล้วโหลดรูปตอนเลื่อนมาถึง (ui.js)
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
          : `<button data-buy="${escapeHtml(p.id)}">${t("buy_now")}</button>`}
      </div>`;
  }).join("");
  window.watchProductImages?.(grid);
}

// ===== ข้อมูลไอดีเกมของลูกค้า (ของเติมเกม) =====
// แอดมินติ๊กไว้ที่สินค้าว่าต้องขออะไร ลูกค้าต้องกรอกให้ครบก่อนถึงจะกดยืนยันได้
const needsInfo = p => !!(p?.askUid || p?.askLogin);

const infoFieldsOf = p => [
  ...(p?.askUid ? [{ k: "gameUid", label: "your_game_uid" }] : []),
  ...(p?.askLogin ? [{ k: "gameLogin", label: "your_game_login" },
                     { k: "gamePassword", label: "your_game_password" }] : []),
];

function customerInfoFields(p) {
  if (!needsInfo(p)) return "";
  const saved = BUY?.info || {};
  const rows = infoFieldsOf(p).map(f => `
    <label for="bf-${f.k}">${t(f.label)} <span class="req">*</span></label>
    <input type="text" id="bf-${f.k}" autocomplete="off" spellcheck="false"
           data-info-key="${f.k}" value="${escapeHtml(saved[f.k] || "")}">`).join("");
  return `<div class="cust-fields">${rows}
    ${p.askLogin ? `<div class="hint warn-note">${t("password_warning")}</div>` : ""}</div>`;
}

// ยังกรอกไม่ครบไหม
function missingInfo(p) {
  if (!needsInfo(p)) return false;
  const saved = BUY?.info || {};
  return infoFieldsOf(p).some(f => !String(saved[f.k] || "").trim());
}

// ส่งเฉพาะช่องที่สินค้านั้นขอจริง (เซิร์ฟเวอร์ตรวจซ้ำอีกชั้น)
function infoForOrder(p) {
  const saved = BUY?.info || {};
  const out = {};
  infoFieldsOf(p).forEach(f => { out[f.k] = String(saved[f.k] || "").trim(); });
  return out;
}

// ---------- หน้าต่างสั่งซื้อ ----------
function openPanel(id) { document.getElementById(id).classList.add("open"); }
function closePanel(id) { document.getElementById(id).classList.remove("open"); }

// สินค้าดิจิทัล (ไอดีเกม) ได้ของทันที · ที่เหลือคือของเติมเกม ต้องรอแอดมิน
const isDigital = p => p?.digital === true;

function openBuy(id) {
  const p = findProduct(id);
  if (!p || p.active === false) return;
  if (p.stock != null && p.stock <= 0) return;

  BUY = { id: String(id), qty: 1, info: {}, accepted: false, busy: false };

  // ขั้นที่ 1 เสมอ (เผื่อรอบก่อนจบที่หน้าจอ "ซื้อสำเร็จ")
  document.getElementById("buy-form").classList.remove("hidden");
  document.getElementById("buy-done").classList.add("hidden");

  const lang = getLang();
  const name = (lang === "en" && p.name_en) || p.name || "";
  const desc = (lang === "en" && p.desc_en) || p.desc || "";
  document.getElementById("buy-head").innerHTML = `
    <div class="bh-thumb">${productImage(p)}</div>
    <div class="bh-body">
      <b>${escapeHtml(name)}</b>
      ${desc ? `<div class="muted">${escapeHtml(desc)}</div>` : ""}
      <div class="muted">${t("unit_price")} ${money(p.price)}</div>
      ${p.stock != null ? `<div class="muted">${t("stock_left")} ${p.stock}</div>` : ""}
    </div>`;

  document.getElementById("buy-fields").innerHTML = customerInfoFields(p);

  // เงื่อนไขการเคลม — ข้อความมาจาก i18n ทั้งประโยค ตัวเลขนาทีมาจาก shop-config
  const mins = claimMinutes();
  document.getElementById("buy-terms-list").innerHTML = [
    t(isDigital(p) ? "order_terms_video_id" : "order_terms_video_topup"),
    tv("order_terms_time", { n: mins }),
    t("order_terms_novideo"),
  ].map(s => `<li>${escapeHtml(s)}</li>`).join("");

  const qtyBox = document.getElementById("buy-qty");
  qtyBox.value = "1";
  qtyBox.max = p.stock != null ? String(p.stock) : "999";
  document.getElementById("buy-accept").checked = false;

  syncBuy();
  openPanel("buy-overlay");
}

// เพดานจำนวนที่สั่งได้ต่อครั้ง (สต๊อกไม่จำกัดก็ยังต้องมีเพดาน ไม่งั้นพิมพ์เลขมหาศาลได้)
const maxQtyOf = p => Math.min(999, p?.stock != null ? p.stock : 999);

// บีบค่าจำนวนให้ใช้ได้จริง — **"ไม่ต่ำกว่า 1" ต้องเป็นขั้นสุดท้ายเสมอ**
// ถ้าเอาเพดานไว้ท้าย พอสินค้าหมดระหว่างที่กล่องเปิดค้างอยู่ (เพดาน = 0) จำนวนจะกลายเป็น 0
// แล้วยอดรวมเป็น ฿0 · คำเตือน "ของไม่พอ" หายไป (0 ไม่มากกว่า 0) · ปุ่มยืนยันกลับมากดได้
// เขียนไว้ที่เดียวเพราะเคยพลาดมาแล้วจากการเขียนซ้ำสองที่แล้วแก้ไม่ครบ
function clampQty(p, n) {
  return Math.max(1, Math.min(maxQtyOf(p), Math.floor(Number(n) || 1)));
}

function setQty(n) {
  const p = findProduct(BUY?.id);
  if (!p) return;
  const v = clampQty(p, n);
  BUY.qty = v;
  document.getElementById("buy-qty").value = String(v);
  syncBuy();
}

// อัปเดตเฉพาะตัวเลข/ข้อความ/ปุ่ม — ไม่วาดช่องกรอกใหม่ ไม่งั้นเคอร์เซอร์เด้งทุกครั้งที่พิมพ์
function syncBuy() {
  const p = findProduct(BUY?.id);
  const btn = document.getElementById("buy-confirm");
  if (!p || !btn) return;

  const total = Math.round(Number(p.price) * BUY.qty * 100) / 100;
  const signedIn = !!window.QQ?.user;
  const credit = window.QQ?.credit || 0;

  document.getElementById("buy-total").textContent = money(total);
  document.getElementById("buy-credit").textContent = money(credit);
  document.getElementById("buy-after").textContent = money(Math.round((credit - total) * 100) / 100);
  document.getElementById("buy-credit-row").classList.toggle("hidden", !signedIn);
  document.getElementById("buy-after-row").classList.toggle("hidden", !signedIn || credit < total);

  const msg = document.getElementById("buy-msg");
  const show = (text, kind) => {
    msg.textContent = text;
    msg.className = "msg" + (text ? " show " + kind : "");
  };

  if (BUY.busy) { btn.disabled = true; return; }
  if (p.stock != null && BUY.qty > p.stock) { btn.disabled = true; show(t("stock_not_enough"), "warn"); return; }
  // ยังไม่ล็อกอิน: ปล่อยให้กดได้ แล้วพาไปหน้าเข้าสู่ระบบ (กันลูกค้างงว่าปุ่มกดไม่ได้)
  if (!signedIn) { btn.disabled = false; show(t("login_required"), "warn"); return; }
  if (credit < total) { btn.disabled = true; show(t("not_enough_credit"), "warn"); return; }
  if (missingInfo(p)) { btn.disabled = true; show(t("fill_customer_info"), "warn"); return; }
  if (!BUY.accepted) { btn.disabled = true; show(t("accept_terms_required"), "warn"); return; }
  btn.disabled = false; show("");
}

// ---------- ยืนยันสั่งซื้อ ----------
async function doBuy() {
  if (!BUY || BUY.busy) return;
  if (!window.QQ?.user) { location.href = "login.html?next=index.html"; return; }

  const p = findProduct(BUY.id);
  if (!p || !BUY.accepted || missingInfo(p)) { syncBuy(); return; }

  BUY.busy = true;
  syncBuy();
  try {
    const res = await QQ.createOrder([{ id: BUY.id, qty: BUY.qty, ...infoForOrder(p) }]);

    // ออเดอร์สำเร็จแล้วตั้งแต่บรรทัดบน — ตั้งแต่จุดนี้ไปห้ามโยนข้อผิดพลาดเด็ดขาด
    // ถ้าขั้นตอนเก็บกวาดพลาดแล้วหลุดไปเข้า catch ลูกค้าจะเห็นว่า "สั่งซื้อไม่สำเร็จ"
    // ทั้งที่เครดิตถูกหักไปแล้ว แล้วกดสั่งซ้ำอีกรอบ = เสียเงินสองรอบ
    try { showBuyDone(res, p); } catch (err) { console.warn("วาดหน้าจอสำเร็จไม่ได้", err); }
    // ล้างรหัสผ่านลูกค้าออกจากหน่วยความจำทันทีที่สั่งซื้อเสร็จ
    if (BUY) BUY.info = {};
    // สต๊อก/เครดิตเปลี่ยนไปแล้ว ดึงของใหม่ให้หน้าร้านตรงกับความจริง
    loadProducts().catch(err => console.warn("โหลดสินค้าใหม่ไม่ได้", err));
  } catch (e) {
    const key = "o_" + (e.orderCode || "");
    alert(t(key) === key ? QQ.friendlyError(e) : t(key));
    // เซิร์ฟเวอร์อาจเจอว่าของหมด/ราคาเปลี่ยน หลังเราเช็คไปแล้ว จึงรีเฟรชให้เห็นของจริง
    await loadProducts();
  } finally {
    if (BUY) BUY.busy = false;
    syncBuy();
  }
}

// หน้าจอ "ซื้อสำเร็จ" — บอกให้ชัดว่าได้ของแล้วหรือรออยู่ และเวลาเคลมเริ่มนับเมื่อไหร่
function showBuyDone(res, p) {
  const digital = res.kind ? res.kind === "digital" : isDigital(p);
  const mins = claimMinutes();
  const orderNo = String(res.orderId || "").slice(0, 8).toUpperCase();

  document.getElementById("buy-done-msg").textContent =
    t(digital ? "buy_success_digital" : "buy_success_topup");
  document.getElementById("buy-done-id").textContent = orderNo;
  document.getElementById("buy-done-copy").dataset.copy = orderNo;
  document.getElementById("buy-done-claim").textContent =
    tv(digital ? "claim_timer_started" : "claim_timer_later", { n: mins });

  document.getElementById("buy-form").classList.add("hidden");
  document.getElementById("buy-done").classList.remove("hidden");
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
  if (BUY) syncBuy();
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
  if (BUY) syncBuy();
}

document.getElementById("grid")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-buy]");
  if (btn) openBuy(btn.dataset.buy);
});

// ---------- ปุ่ม/ช่องในหน้าต่างสั่งซื้อ ----------
document.getElementById("buy-minus")?.addEventListener("click", () => setQty((BUY?.qty || 1) - 1));
document.getElementById("buy-plus")?.addEventListener("click", () => setQty((BUY?.qty || 1) + 1));

// พิมพ์เองในช่องจำนวน — ปล่อยให้พิมพ์ว่างชั่วคราวได้ ไม่งั้นลบตัวเลขไม่ได้เลย
document.getElementById("buy-qty")?.addEventListener("input", e => {
  if (!BUY) return;
  const raw = String(e.target.value).trim();
  if (raw === "") { BUY.qty = 1; syncBuy(); return; }
  const p = findProduct(BUY.id);
  BUY.qty = clampQty(p, raw);
  syncBuy();
});
// ออกจากช่องแล้วค่อยดันค่าที่ใช้ได้จริงกลับเข้าไป (กันค้างเป็นค่าว่าง/ค่าที่เกินเพดาน)
document.getElementById("buy-qty")?.addEventListener("blur", () => { if (BUY) setQty(BUY.qty); });

document.getElementById("buy-fields")?.addEventListener("input", e => {
  const el = e.target.closest("[data-info-key]");
  if (!el || !BUY) return;
  BUY.info[el.dataset.infoKey] = el.value;
  syncBuy();
});

document.getElementById("buy-accept")?.addEventListener("change", e => {
  if (BUY) BUY.accepted = e.target.checked;
  syncBuy();
});

document.getElementById("buy-confirm")?.addEventListener("click", doBuy);
document.getElementById("buy-again")?.addEventListener("click", () => closePanel("buy-overlay"));

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
document.addEventListener("langchange", () => {
  renderCatTabs();
  renderProducts();
  // หน้าต่างสั่งซื้อที่เปิดค้างอยู่ต้องเปลี่ยนภาษาตามด้วย
  // วาดใหม่ทั้งกล่องแล้วเอาสิ่งที่ลูกค้ากรอก/ติ๊กไว้กลับคืน (BUY เก็บค่าไว้อยู่แล้ว)
  if (BUY && document.getElementById("buy-overlay")?.classList.contains("open")
      && !document.getElementById("buy-form").classList.contains("hidden")) {
    const keep = { qty: BUY.qty, info: { ...BUY.info }, accepted: BUY.accepted };
    openBuy(BUY.id);
    BUY.info = keep.info;
    BUY.accepted = keep.accepted;
    document.getElementById("buy-accept").checked = keep.accepted;
    document.getElementById("buy-fields").innerHTML = customerInfoFields(findProduct(BUY.id));
    setQty(keep.qty);
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  renderCatTabs();
  if (window.QQ?.isConfigured) { await QQ.whenAuthReady(); await loadProducts(); }
  syncNav();
});
