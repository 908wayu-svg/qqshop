// ===== หลังบ้าน: ภาพรวม / ออเดอร์ / เติมเงิน / สินค้า / สมาชิก =====
import { QQ } from "./auth.js";
import { angpaoRedeemUrl, CATEGORIES } from "./shop-config.js";

let ORDERS = [], USERS = [], TOPUPS = [], PRODUCTS = [], SETTINGS = {};
let RANGE = 30;
let ORDER_FILTER = "pending", TOPUP_FILTER = "pending";
let EDITING_PRODUCT = null, PRODUCT_IMAGE = null, CREDIT_TARGET = null, IMAGE_CHANGED = false;
let STOCK_ITEMS = [];

// ---------- utils ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtNum = n => Number(n || 0).toLocaleString();

// ===== กรองค่าที่มาจากผู้ใช้ก่อนเอาไปใส่ใน src/href =====
// ลูกค้าเขียนฟิลด์ slip / angpaoLink เองได้ ถ้าไม่กรองจะยัดสคริปต์เข้าหน้าแอดมินได้
const safeImg = s =>
  /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(String(s || ""))
    ? String(s) : null;

const safeLink = u => {
  try {
    const url = new URL(String(u));
    return url.protocol === "https:" && /(^|\.)truemoney\.com$/.test(url.hostname)
      ? url.href : null;
  } catch { return null; }
};

const toDate = ts => !ts ? null : (typeof ts.toDate === "function" ? ts.toDate() : new Date(ts));

// ใช้วันที่ตามเวลาท้องถิ่น (ไม่ใช่ UTC) ไม่งั้นออเดอร์ช่วงเช้าจะถูกนับผิดวัน
const dayKey = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function dayLabel(key) {
  const d = new Date(key + "T00:00:00");
  return getLang() === "th"
    ? d.toLocaleDateString("th-TH", { day: "numeric", month: "short" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fmtDateTime(d) {
  if (!d) return "—";
  return getLang() === "th"
    ? d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function rangeStart() {
  if (RANGE === "all") return new Date(0);
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (RANGE - 1));
  return d;
}

const statusBadge = s => `<span class="badge ${s}">${t("st_" + s)}</span>`;

// processing = บอทเริ่มทำแล้วแต่ยังไม่จบ ต้องโผล่ในตัวกรอง "รออนุมัติ"
// ไม่งั้นรายการค้างจะหายไปจากสายตาแอดมินทั้งที่ลูกค้าเสียเงินไปแล้ว
const OPEN_STATES = ["pending", "processing"];
const matchFilter = (status, filter) =>
  filter === "all" ? true
  : filter === "pending" ? OPEN_STATES.includes(status)
  : status === filter;

function dailySeries(records, valueFn) {
  const start = RANGE === "all"
    ? (records.length ? new Date(Math.min(...records.map(r => r._date.getTime()))) : new Date())
    : rangeStart();
  const startDay = new Date(start); startDay.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(0, 0, 0, 0);

  const buckets = new Map();
  for (let d = new Date(startDay); d <= end; d.setDate(d.getDate() + 1)) buckets.set(dayKey(d), 0);
  records.forEach(r => {
    const k = dayKey(r._date);
    if (buckets.has(k)) buckets.set(k, buckets.get(k) + valueFn(r));
  });
  return [...buckets.entries()].map(([key, value]) => ({ key, label: dayLabel(key), value }));
}

// ---------- กราฟ ----------
function emptyState(box) { box.innerHTML = `<div class="chart-empty">${t("no_data")}</div>`; }

function chartTooltip(box) {
  let tip = box.querySelector(".chart-tip");
  if (!tip) { tip = document.createElement("div"); tip.className = "chart-tip"; box.appendChild(tip); }
  return tip;
}

function lineChart(box, data, { color, format }) {
  if (!data.length || data.every(d => d.value === 0)) return emptyState(box);

  const W = Math.max(box.clientWidth || 640, 320), H = 240;
  const P = { t: 16, r: 16, b: 28, l: 56 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const niceMax = Math.ceil((Math.max(...data.map(d => d.value)) || 1) / 4) * 4 || 4;
  const x = i => P.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = v => P.t + ih - (v / niceMax) * ih;

  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(niceMax * f)).map(v => `
    <line class="grid" x1="${P.l}" y1="${y(v)}" x2="${W - P.r}" y2="${y(v)}"/>
    <text class="axis" x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end">${format(v)}</text>`).join("");

  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(data.length - 1).toFixed(1)},${P.t + ih} L${x(0).toFixed(1)},${P.t + ih} Z`;
  const step = Math.max(1, Math.ceil(data.length / 6));
  const xLabels = data.map((d, i) => (i % step === 0 || i === data.length - 1)
    ? `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${d.label}</text>` : "").join("");
  const dots = data.map((d, i) =>
    `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(d.value).toFixed(1)}" r="4"/>`).join("");

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="--c:${color}">
      <defs><linearGradient id="g-${box.id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity=".18"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <path d="${area}" fill="url(#g-${box.id})"/>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}${xLabels}
      <line class="crosshair" y1="${P.t}" y2="${P.t + ih}" style="display:none"/>
    </svg>`;

  const svg = box.querySelector("svg");
  const tip = chartTooltip(box);
  const cross = svg.querySelector(".crosshair");
  svg.querySelectorAll(".dot").forEach(c => c.style.stroke = "var(--surface-1)");

  svg.addEventListener("mousemove", e => {
    const r = svg.getBoundingClientRect();
    let i = Math.round((((e.clientX - r.left) * (W / r.width) - P.l) / iw) * (data.length - 1));
    i = Math.min(data.length - 1, Math.max(0, i));
    const d = data[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
    cross.style.display = "";
    tip.innerHTML = `<b>${d.label}</b><br>${format(d.value)}`;
    tip.style.display = "block";
    tip.style.left = Math.min(Math.max((x(i) / W) * r.width, 40), r.width - 40) + "px";
    tip.style.top = ((y(d.value) / H) * r.height - 12) + "px";
  });
  svg.addEventListener("mouseleave", () => { tip.style.display = "none"; cross.style.display = "none"; });
}

function barChart(box, items, { color, format }) {
  if (!items.length) return emptyState(box);
  const rowH = 34, P = { t: 8, r: 95, b: 8, l: 150 };
  const W = Math.max(box.clientWidth || 640, 320);
  const H = P.t + P.b + items.length * rowH;
  const iw = W - P.l - P.r;
  const max = Math.max(...items.map(d => d.value)) || 1;

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${
    items.map((d, i) => {
      const w = Math.max((d.value / max) * iw, 3);
      const y = P.t + i * rowH + 6, h = rowH - 14;
      // ตัดชื่อยาวไม่ให้ล้นออกนอกกราฟ
      const label = d.label.length > 20 ? d.label.slice(0, 19) + "…" : d.label;
      return `
        <text class="axis name" x="${P.l - 12}" y="${y + h / 2 + 4}" text-anchor="end">${esc(label)}<title>${esc(d.label)}</title></text>
        <rect class="bar" x="${P.l}" y="${y}" width="${w}" height="${h}" rx="4" fill="${color}"/>
        <text class="value" x="${P.l + w + 10}" y="${y + h / 2 + 4}">${format(d.value)}</text>`;
    }).join("")}</svg>`;
}

// ---------- ภาพรวม ----------
// จุดเริ่มนับยอดขายใหม่ (ถ้าแอดมินเคยกดรีเซ็ต)
function salesResetAt() {
  const v = SETTINGS.salesResetAt;
  return v ? (typeof v.toDate === "function" ? v.toDate() : new Date(v)) : null;
}

function renderOverview() {
  const reset = salesResetAt();
  const start = reset && reset > rangeStart() ? reset : rangeStart();
  const inRange = arr => arr.filter(x => x._date && x._date >= start);

  // แสดงว่ากำลังนับจากจุดไหน
  const info = document.getElementById("reset-info");
  info.textContent = reset ? `${t("counting_since")} ${fmtDateTime(reset)}` : "";
  document.getElementById("btn-undo-reset").classList.toggle("hidden", !reset);

  const approved = inRange(ORDERS.filter(o => o.status === "approved"));
  // สมาชิกไม่เกี่ยวกับการรีเซ็ตยอดขาย จึงใช้ช่วงเวลาปกติ
  const users = USERS.filter(u => u._date && u._date >= rangeStart());
  const sales = approved.reduce((s, o) => s + (o.total || 0), 0);

  const set = (id, v) => { document.getElementById(id).textContent = v; };
  set("kpi-sales", money(sales));
  set("kpi-orders", fmtNum(approved.length));
  set("kpi-avg", approved.length ? money(sales / approved.length) : "—");
  set("kpi-members", fmtNum(USERS.length));
  set("kpi-pending-orders", fmtNum(ORDERS.filter(o => OPEN_STATES.includes(o.status)).length));
  set("kpi-pending-topups", fmtNum(TOPUPS.filter(x => OPEN_STATES.includes(x.status)).length));
  set("kpi-credit", money(USERS.reduce((s, u) => s + Number(u.credit || 0), 0)));

  lineChart(document.getElementById("chart-sales"),
    dailySeries(approved, o => o.total || 0), { color: "var(--series-1)", format: money });
  lineChart(document.getElementById("chart-members"),
    dailySeries(users, () => 1), { color: "var(--series-2)", format: fmtNum });

  const byProduct = new Map();
  approved.forEach(o => (o.items || []).forEach(i =>
    byProduct.set(i.name, (byProduct.get(i.name) || 0) + (i.price || 0) * (i.qty || 0))));
  barChart(document.getElementById("chart-products"),
    [...byProduct.entries()].map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value).slice(0, 8),
    { color: "var(--series-1)", format: money });

  // ตัวเลขแจ้งเตือนบนแท็บ
  const pill = (id, n) => {
    const el = document.getElementById(id);
    el.textContent = n; el.classList.toggle("hidden", !n);
  };
  pill("pill-orders", ORDERS.filter(o => OPEN_STATES.includes(o.status)).length);
  pill("pill-topups", TOPUPS.filter(x => OPEN_STATES.includes(x.status)).length);
}

// ---------- ออเดอร์ ----------
function renderOrders() {
  const list = ORDERS.filter(o => matchFilter(o.status, ORDER_FILTER));
  const el = document.getElementById("table-orders");
  if (!list.length) { el.innerHTML = `<tr><td class="empty">${t("no_data")}</td></tr>`; return; }

  el.innerHTML = `
    <thead><tr>
      <th>${t("date")}</th><th>${t("customer")}</th><th>${t("items")}</th>
      <th class="num">${t("amount")}</th><th>${t("status")}</th><th></th>
    </tr></thead>
    <tbody>${list.slice(0, 100).map(o => {
      const pc = priceCheck(o);
      return `
      <tr>
        <td data-label="${t("date")}">${fmtDateTime(o._date)}</td>
        <td data-label="${t("customer")}">${esc(o.customerName || "—")}<br><small>${esc(o.customerEmail || "")}</small>
            <br><small class="credit-note">${t("credit")}: ${money(creditOf(o.uid))}</small></td>
        <td data-label="${t("items")}"><small>${esc((o.items || []).map(i => `${i.name} ×${i.qty}`).join(", "))}</small>
            ${customerInfoBlock(o)}</td>
        <td class="num" data-label="${t("amount")}">${money(o.total)}${priceWarnLabel(pc)}</td>
        <td data-label="${t("status")}">${statusBadge(o.status)}${o.note ? `<br><small>${esc(o.note)}</small>` : ""}</td>
        <td class="actions">${o.status === "pending" ? `
          <button class="btn-small ok" data-act="approve-order" data-id="${o.id}">${t("approve")}</button>
          <button class="btn-small danger" data-act="reject-order" data-id="${o.id}">${t("reject")}</button>` : ""}
          ${hasCustomerPassword(o) ? `
          <button class="btn-small" data-act="clear-cust-info" data-id="${o.id}">${t("clear_customer_info")}</button>` : ""}
        </td>
      </tr>`;
    }).join("")}</tbody>`;
}

const creditOf = uid => Number(USERS.find(u => u.id === uid)?.credit || 0);

// ===== ข้อมูลไอดีเกมที่ลูกค้ากรอกมา (ของเติมเกม) =====
// โชว์ให้แอดมินเห็นในออเดอร์ จะได้เติมเข้าไอดีถูกคน
const hasCustomerInfo = o => (o.items || []).some(i => i.gameUid || i.gameLogin || i.gamePassword);
const hasCustomerPassword = o => (o.items || []).some(i => i.gameLogin || i.gamePassword);

function customerInfoBlock(o) {
  if (!hasCustomerInfo(o)) return "";
  const line = (label, value) => value
    ? `<div class="ci-row"><span>${label}</span><b>${esc(value)}</b>
         <button class="copy" data-copy="${esc(value)}">⧉</button></div>` : "";
  const blocks = (o.items || []).filter(i => i.gameUid || i.gameLogin || i.gamePassword).map(i => `
    <div class="ci-item">
      <div class="ci-name">${esc(i.name)}</div>
      ${line(t("ask_uid"), i.gameUid)}
      ${line(t("item_login"), i.gameLogin)}
      ${line(t("item_password"), i.gamePassword)}
    </div>`).join("");
  return `<div class="cust-info"><div class="ci-head">${t("customer_info")}</div>${blocks}
    ${o.customerInfoClearedAt ? `<div class="ci-cleared">${t("customer_info_cleared")}</div>` : ""}</div>`;
}

// ยอดเงินในออเดอร์ส่งมาจากเบราว์เซอร์ลูกค้า จึงต้องคิดใหม่จากราคาสินค้าจริงเพื่อกันการแก้ราคา
// ถ้าอ้างถึงสินค้าที่ไม่มีในระบบ ต้องเตือนด้วย ไม่ใช่เงียบ (ไม่งั้นเลี่ยงการตรวจได้ด้วยรหัสมั่ว)
function priceCheck(order) {
  const items = order.items || [];
  if (!items.length) return { unknown: true, ok: false };

  let real = 0;
  for (const i of items) {
    const p = PRODUCTS.find(x => x.id === String(i.id));
    if (!p) return { unknown: true, ok: false };   // สินค้าถูกลบ หรือรหัสไม่มีจริง
    real += Number(p.price) * Number(i.qty);
  }
  return { real, ok: Math.abs(real - Number(order.total)) < 0.01 };
}

// ป้ายเตือนท้ายยอดเงินในตารางออเดอร์
function priceWarnLabel(pc) {
  if (!pc || pc.ok) return "";
  return pc.unknown
    ? `<br><small class="price-warn" title="${t("price_uncheckable")}">⚠ ${t("check_manually")}</small>`
    : `<br><small class="price-warn" title="${t("price_mismatch")}">⚠ ${money(pc.real)}</small>`;
}

// ---------- เติมเงิน ----------
const METHOD_KEY = { truewallet: "m_truewallet", angpao: "m_angpao", bank: "m_bank", promptpay: "m_promptpay", admin: "m_admin" };

// ช่อง "สลิป" ในตารางเติมเงิน — ค่าทั้งหมดมาจากลูกค้า จึงต้องกรองก่อนแสดง
function slipCell(x) {
  // รายการเก่าเก็บสลิปไว้ในเอกสารเดียวกัน — ยังต้องรองรับ
  const img = safeImg(x.slip);
  if (img) return `<img class="slip-thumb" src="${img}" alt="slip">`;

  // รายการใหม่เก็บสลิปแยกเอกสาร โหลดเฉพาะตอนกดดู
  // (ถ้าโหลดมาพร้อมตาราง 500 รายการ = รูป base64 หลายสิบ MB เบราว์เซอร์ค้าง)
  if (x.hasSlip) {
    return `<button class="btn-small" data-slip="${esc(x.id)}">🧾 ${t("view_slip")}</button>`;
  }

  const link = safeLink(angpaoRedeemUrl(x.angpaoLink));
  if (link) return `<a class="btn-small" href="${esc(link)}" target="_blank" rel="noopener">🧧 ${t("open_angpao")}</a>`;

  // มีค่าอยู่แต่ไม่ผ่านการตรวจ = ข้อมูลผิดปกติ แจ้งเตือนแทนที่จะแสดงเฉยๆ
  if (x.slip || x.angpaoLink) return `<span class="badge rejected">${t("bad_attachment")}</span>`;
  return "—";
}

function renderTopups() {
  const list = TOPUPS.filter(x => matchFilter(x.status, TOPUP_FILTER));
  const el = document.getElementById("table-topups");
  if (!list.length) { el.innerHTML = `<tr><td class="empty">${t("no_data")}</td></tr>`; return; }

  el.innerHTML = `
    <thead><tr>
      <th>${t("date")}</th><th>${t("customer")}</th><th>${t("method")}</th>
      <th>${t("slip")}</th><th class="num">${t("amount")}</th><th>${t("status")}</th><th></th>
    </tr></thead>
    <tbody>${list.slice(0, 100).map(x => `
      <tr>
        <td data-label="${t("date")}">${fmtDateTime(x._date)}</td>
        <td data-label="${t("customer")}">${esc(x.name || "—")}<br><small>${esc(x.email || "")}</small></td>
        <td data-label="${t("method")}">${t(METHOD_KEY[x.method] || "m_admin")}</td>
        <td data-label="${t("slip")}">${slipCell(x)}</td>
        <td class="num" data-label="${t("amount")}">${money(x.amount)}${OPEN_STATES.includes(x.status) && !(Number(x.amount) > 0)
          ? `<br><small class="price-warn">⚠ ${t("needs_amount")}</small>` : ""}</td>
        <td data-label="${t("status")}">${statusBadge(x.status)}${x.note ? `<br><small>${esc(x.note)}</small>` : ""}${
          x.status === "processing" ? `<br><small class="price-warn">${t("stuck_check_first")}</small>` : ""}</td>
        <td class="actions">${OPEN_STATES.includes(x.status) ? `
          <button class="btn-small ok" data-act="approve-topup" data-id="${x.id}">${t("approve")}</button>
          <button class="btn-small danger" data-act="reject-topup" data-id="${x.id}">${t("reject")}</button>` : ""}
        </td>
      </tr>`).join("")}</tbody>`;
}

// ---------- สินค้า ----------
// รายชื่อหมวดหมู่มาจาก shop-config.js ที่เดียว — เติมช่อง select ตอนโหลดหน้าครั้งเดียว
function populateCategorySelect() {
  const sel = document.getElementById("p-category");
  if (!sel) return;
  const keep = sel.value;   // อย่าให้ค่าที่เลือกไว้หายตอนสลับภาษา
  sel.innerHTML = `<option value="">${t("category_none")}</option>`
    + CATEGORIES.map(c => `<option value="${esc(c.id)}">${c.icon} ${t("cat_" + c.id)}</option>`).join("");
  sel.value = keep;
}
populateCategorySelect();
document.addEventListener("langchange", populateCategorySelect);

const categoryLabel = id => id ? (CATEGORIES.find(c => c.id === id)
  ? `${CATEGORIES.find(c => c.id === id).icon} ${t("cat_" + id)}` : id) : t("category_none");

// รูปสินค้าเก็บแยกเอกสาร โหลดตอนเลื่อนมาถึงเท่านั้น (img.js)
function productThumb(p) {
  const legacy = safeImg(p.image);
  if (legacy) return `<img src="${legacy}" alt="">`;
  if (p.hasImage) return `<img class="lazy" data-pimg="${esc(p.id)}" src="${window.BLANK_IMG}" alt="">`;
  return `<span class="emoji">${esc(p.emoji) || "🛍️"}</span>`;
}

function renderProducts() {
  const el = document.getElementById("product-list");
  if (!PRODUCTS.length) { el.innerHTML = `<div class="empty">${t("no_data")}</div>`; return; }

  el.innerHTML = PRODUCTS.map(p => `
    <div class="padmin${p.active === false ? " off" : ""}">
      <div class="padmin-img">${productThumb(p)}</div>
      <div class="padmin-body">
        <b>${esc(p.name)}</b>
        <div class="muted">${money(p.price)} · ${t("stock")} ${p.stock ?? "∞"}</div>
        <div class="muted">${p.active === false ? t("inactive") : t("active")} · ${categoryLabel(p.category)}</div>
      </div>
      <button class="btn-small" data-act="edit-product" data-id="${p.id}">${t("edit")}</button>
    </div>`).join("");
  window.watchProductImages?.(el);
}

async function openProductModal(product) {
  EDITING_PRODUCT = product;
  PRODUCT_IMAGE = product?.image || null;   // สินค้าเก่าที่ยังฝังรูปไว้ในเอกสาร
  IMAGE_CHANGED = false;                    // ยังไม่ได้แตะรูป = ตอนบันทึกจะไม่เขียนทับ
  STOCK_ITEMS = [];
  const v = (id, val) => { document.getElementById(id).value = val ?? ""; };
  document.getElementById("product-modal-title").textContent = product ? t("edit_product") : t("add_product");
  v("p-name", product?.name); v("p-name-en", product?.name_en);
  v("p-desc", product?.desc); v("p-desc-en", product?.desc_en);
  v("p-price", product?.price ?? ""); v("p-stock", product?.stock ?? "");
  v("p-emoji", product?.emoji); v("p-image", "");
  v("p-category", product?.category);
  document.getElementById("p-active").checked = product ? product.active !== false : true;
  document.getElementById("p-digital").checked = !!product?.digital;
  document.getElementById("p-ask-uid").checked = !!product?.askUid;
  document.getElementById("p-ask-login").checked = !!product?.askLogin;
  document.getElementById("p-delete").classList.toggle("hidden", !product);
  setMsg("p-msg", "");
  renderProductPreview();
  syncDigitalUI();
  document.getElementById("product-overlay").classList.add("open");

  // รูปเดิมโหลดตอนเปิดหน้าต่างเท่านั้น
  if (!PRODUCT_IMAGE && product?.hasImage) {
    PRODUCT_IMAGE = await QQ.fetchProductImage(product.id).catch(() => null);
    renderProductPreview();
  }

  // คลังสินค้าโหลดได้เฉพาะสินค้าที่บันทึกแล้ว
  if (product?.digital) await loadStockItems();
}

// สินค้าดิจิทัลให้สต๊อกนับจากจำนวนชิ้นในคลังแทนการพิมพ์เอง
function syncDigitalUI() {
  const digital = document.getElementById("p-digital").checked;
  document.getElementById("p-stock-box").classList.toggle("hidden", digital);
  const box = document.getElementById("p-stockitems");
  box.classList.toggle("hidden", !digital);
  document.getElementById("si-hint").textContent =
    EDITING_PRODUCT ? t("stock_items_hint") : t("save_product_first");
  document.getElementById("si-add").disabled = !EDITING_PRODUCT;
}

async function loadStockItems() {
  if (!EDITING_PRODUCT) return;
  STOCK_ITEMS = await QQ.fetchStockItems(EDITING_PRODUCT.id);
  renderStockItems();
}

function renderStockItems() {
  const box = document.getElementById("si-list");
  const available = STOCK_ITEMS.filter(i => i.status === "available").length;
  const draft = STOCK_ITEMS.filter(i => i.status === "draft").length;
  document.getElementById("si-count").textContent =
    `(${t("available")} ${available} / ${t("all")} ${STOCK_ITEMS.length}`
    + (draft ? ` · ${t("draft_items")} ${draft}` : "") + ")";

  if (!STOCK_ITEMS.length) { box.innerHTML = `<div class="empty">${t("no_stock_items")}</div>`; return; }

  box.innerHTML = STOCK_ITEMS.map((it, idx) => {
    const sold = it.status === "sold";
    return `
      <div class="si-row${sold ? " sold" : ""}" data-id="${it.id}">
        <span class="si-no">#${idx + 1}</span>
        <input class="si-login" data-f="login" value="${esc(it.login)}"
               placeholder="${t("item_login")}" ${sold ? "disabled" : ""}>
        <input class="si-pass" data-f="password" value="${esc(it.password)}"
               placeholder="${t("item_password")}" ${sold ? "disabled" : ""}>
        <input class="si-note" data-f="note" value="${esc(it.note)}"
               placeholder="${t("note_optional")}" ${sold ? "disabled" : ""}>
        ${sold
          ? `<span class="badge approved">${t("sold_out_item")}</span>`
          : `${it.status === "draft" ? `<span class="badge pending">${t("draft_item")}</span>` : ""}
             <button class="btn-small danger" data-si-del="${it.id}">✕</button>`}
      </div>`;
  }).join("");
}

// เก็บค่าที่พิมพ์ในคลังทั้งหมดลงฐานข้อมูล
async function saveStockItems() {
  if (!EDITING_PRODUCT) return;
  const rows = [...document.querySelectorAll("#si-list .si-row:not(.sold)")];
  const changes = [];
  for (const row of rows) {
    const id = row.dataset.id;
    const data = {};
    row.querySelectorAll("input[data-f]").forEach(inp => { data[inp.dataset.f] = inp.value.trim(); });
    const orig = STOCK_ITEMS.find(i => i.id === id) || {};
    if (data.login !== (orig.login || "") || data.password !== (orig.password || "")
        || data.note !== (orig.note || "")) {
      changes.push({ id, data });
    }
  }
  // เขียนทีเดียวทั้งชุด เร็วกว่าและถ้าพลาดก็ไม่บันทึกครึ่งๆ กลางๆ
  if (changes.length) await QQ.saveStockItemsBulk(EDITING_PRODUCT.id, changes);
  await QQ.syncDigitalStock(EDITING_PRODUCT.id);
}

function renderProductPreview() {
  const box = document.getElementById("p-image-preview");
  const img = safeImg(PRODUCT_IMAGE);
  box.innerHTML = img
    ? `<img src="${img}" alt=""><button class="img-clear" id="p-image-clear">×</button>`
    : `<span class="muted">${t("choose_image")}</span>`;
}

async function saveProduct() {
  const num = id => {
    const raw = document.getElementById(id).value;
    return raw === "" ? null : Number(raw);
  };
  const digital = document.getElementById("p-digital").checked;
  const data = {
    name: document.getElementById("p-name").value.trim(),
    name_en: document.getElementById("p-name-en").value.trim(),
    desc: document.getElementById("p-desc").value.trim(),
    desc_en: document.getElementById("p-desc-en").value.trim(),
    price: num("p-price") || 0,
    emoji: document.getElementById("p-emoji").value.trim(),
    category: document.getElementById("p-category").value,
    // ส่งรูปไปเฉพาะตอนที่แอดมินเปลี่ยนจริง (ไม่งั้นเขียนรูปเดิมทับทุกครั้งที่กดบันทึก)
    ...(IMAGE_CHANGED || !EDITING_PRODUCT ? { image: PRODUCT_IMAGE } : {}),
    active: document.getElementById("p-active").checked,
    digital,
    // ของเติมเกม: บอกหน้าร้านว่าต้องขออะไรจากลูกค้าก่อนสั่งซื้อ
    askUid: document.getElementById("p-ask-uid").checked,
    askLogin: document.getElementById("p-ask-login").checked,
    sort: EDITING_PRODUCT?.sort ?? PRODUCTS.length,
  };
  // สินค้าดิจิทัลไม่ให้พิมพ์สต๊อกเอง ระบบนับจากคลังให้
  if (!digital) data.stock = num("p-stock");
  // สินค้าดิจิทัลชิ้นใหม่ยังไม่มีของในคลัง ต้องเริ่มที่ 0 ไม่ใช่ "ไม่จำกัด"
  else if (!EDITING_PRODUCT) data.stock = 0;

  if (!data.name) return setMsg("p-msg", t("product_name"));
  if (data.price <= 0) return setMsg("p-msg", t("amount_invalid"));

  const btn = document.getElementById("p-save");
  btn.disabled = true;
  try {
    if (EDITING_PRODUCT && digital) await saveStockItems();
    const ref = await QQ.saveProduct(EDITING_PRODUCT?.id, data);

    // เพิ่งสร้างสินค้าดิจิทัลใหม่ ให้เปิดคลังต่อทันทีแทนการปิดหน้าต่าง
    if (!EDITING_PRODUCT && digital) {
      await reloadProducts();
      const created = PRODUCTS.find(p => p.id === ref.id);
      setMsg("p-msg", t("saved_now_add_items"), "ok");
      await openProductModal(created);
      return;
    }
    if (digital) await QQ.syncDigitalStock(EDITING_PRODUCT.id);
    window.closePanel("product-overlay");
    await reloadProducts();
  } catch (e) { setMsg("p-msg", QQ.friendlyError(e)); }
  finally { btn.disabled = false; }
}

// ---------- สมาชิก ----------
function renderMembers() {
  const q = document.getElementById("member-search").value.trim().toLowerCase();
  const list = USERS.filter(u => !q
    || (u.name || "").toLowerCase().includes(q)
    || (u.email || "").toLowerCase().includes(q));
  const el = document.getElementById("table-members");
  if (!list.length) { el.innerHTML = `<tr><td class="empty">${t("no_data")}</td></tr>`; return; }

  el.innerHTML = `
    <thead><tr>
      <th>${t("name")}</th><th>${t("email")}</th><th>${t("signup_method")}</th>
      <th class="num">${t("credit")}</th><th>${t("role")}</th><th>${t("joined")}</th><th></th>
    </tr></thead>
    <tbody>${list.slice(0, 200).map(u => `
      <tr>
        <td data-label="${t("name")}">${esc(u.name || "—")}</td>
        <td data-label="${t("email")}">${esc(u.email || "—")}</td>
        <td data-label="${t("signup_method")}"><span class="badge provider">${esc(u.provider || "email")}</span></td>
        <td class="num" data-label="${t("credit")}"><b>${money(u.credit)}</b></td>
        <td data-label="${t("role")}">${u.role === "admin" ? `<span class="badge admin">${t("role_admin")}</span>` : t("role_member")}</td>
        <td data-label="${t("joined")}">${fmtDateTime(u._date)}</td>
        <td class="actions">
          <button class="btn-small primary" data-act="add-credit" data-id="${u.id}">+ ${t("credit")}</button>
          <button class="btn-small" data-act="toggle-role" data-id="${u.id}">
            ${u.role === "admin" ? t("remove_admin") : t("make_admin")}</button>
        </td>
      </tr>`).join("")}</tbody>`;
}

function setMsg(id, text, kind = "error") {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = "msg" + (text ? " show " + kind : "");
}

// ---------- โหลดข้อมูล ----------
async function reloadAll() {
  const [orders, users, topups, products, settings] = await Promise.all([
    QQ.fetchOrders(), QQ.fetchUsers(), QQ.fetchTopups(), QQ.fetchProducts(), QQ.fetchSettings(),
  ]);
  ORDERS = orders.map(o => ({ ...o, _date: toDate(o.createdAt) }));
  USERS = users.map(u => ({ ...u, _date: toDate(u.createdAt) }));
  TOPUPS = topups.map(x => ({ ...x, _date: toDate(x.createdAt) }));
  PRODUCTS = products;
  SETTINGS = settings;
  renderAll();
}

async function reloadProducts() { PRODUCTS = await QQ.fetchProducts(); renderProducts(); }

// ---------- รีเฟรชเฉพาะแถวที่เพิ่งเปลี่ยน ----------
// เดิมกดอนุมัติ 1 ครั้ง = โหลดใหม่ทั้งออเดอร์+เติมเงิน+สมาชิก+สินค้า (พันกว่ารายการ)
// ร้านที่มีลูกค้าเยอะจะช้าและกินโควตาอ่านของ Firestore จนหมดวันได้
async function patchRow(list, col, id, extra) {
  const fresh = await QQ.fetchOne(col, id);
  const at = list.findIndex(x => x.id === id);
  if (!fresh) { if (at >= 0) list.splice(at, 1); return; }
  const row = { ...fresh, _date: toDate(fresh.createdAt), ...(extra || {}) };
  if (at >= 0) list[at] = row; else list.unshift(row);
}

async function patchUser(uid) {
  if (!uid) return;
  const fresh = await QQ.fetchOne("users", uid);
  const at = USERS.findIndex(u => u.id === uid);
  if (!fresh) { if (at >= 0) USERS.splice(at, 1); return; }
  const row = { ...fresh, _date: toDate(fresh.createdAt) };
  if (at >= 0) USERS[at] = row; else USERS.unshift(row);
}

// ถ้ารีเฟรชแบบเจาะจงพลาด ค่อยถอยไปโหลดใหม่ทั้งหมด (ข้อมูลบนจอต้องตรงเสมอ)
async function refreshAfter(fn) {
  try { await fn(); renderAll(); }
  catch (e) { console.warn("รีเฟรชเฉพาะแถวไม่สำเร็จ โหลดใหม่ทั้งหมด", e); await reloadAll(); }
}

function renderAll() {
  renderOverview(); renderOrders(); renderTopups(); renderProducts(); renderMembers();
}

// ---------- events ----------
document.getElementById("tabs").addEventListener("click", e => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll("#tabs .tab").forEach(b => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".tab-page").forEach(p =>
    p.classList.toggle("hidden", p.id !== "page-" + btn.dataset.tab));
  if (btn.dataset.tab === "overview") renderOverview();
});

document.getElementById("range-filter").addEventListener("click", e => {
  const btn = e.target.closest(".range-btn");
  if (!btn) return;
  document.querySelectorAll("#range-filter .range-btn").forEach(b => b.classList.toggle("active", b === btn));
  RANGE = btn.dataset.range === "all" ? "all" : Number(btn.dataset.range);
  renderOverview();
});

const wireFilter = (id, set) => document.getElementById(id).addEventListener("click", e => {
  const btn = e.target.closest(".range-btn");
  if (!btn) return;
  document.querySelectorAll(`#${id} .range-btn`).forEach(b => b.classList.toggle("active", b === btn));
  set(btn.dataset.st);
});
wireFilter("orders-filter", v => { ORDER_FILTER = v; renderOrders(); });
wireFilter("topups-filter", v => { TOPUP_FILTER = v; renderTopups(); });

document.getElementById("member-search").addEventListener("input", renderMembers);
document.getElementById("btn-add-product").addEventListener("click", () => openProductModal(null));
document.getElementById("p-save").addEventListener("click", saveProduct);

document.getElementById("p-delete").addEventListener("click", async () => {
  if (!EDITING_PRODUCT || !confirm(t("confirm_delete_product"))) return;
  const btn = document.getElementById("p-delete");
  btn.disabled = true;
  try {
    await QQ.deleteProduct(EDITING_PRODUCT.id);
    window.closePanel("product-overlay");
    await reloadProducts();
  } catch (e) { setMsg("p-msg", QQ.friendlyError(e)); }
  finally { btn.disabled = false; }
});

document.getElementById("p-digital").addEventListener("change", async () => {
  syncDigitalUI();
  if (document.getElementById("p-digital").checked && EDITING_PRODUCT) await loadStockItems();
});

document.getElementById("si-add").addEventListener("click", async () => {
  if (!EDITING_PRODUCT) return;
  const btn = document.getElementById("si-add");
  btn.disabled = true;
  try {
    await QQ.saveStockItem(EDITING_PRODUCT.id, null,
      { login: "", password: "", note: "", sort: STOCK_ITEMS.length });
    await loadStockItems();
    await QQ.syncDigitalStock(EDITING_PRODUCT.id);
    document.querySelector("#si-list .si-row:last-child .si-login")?.focus();
  } catch (e) { setMsg("p-msg", QQ.friendlyError(e)); }
  finally { btn.disabled = false; }
});

document.getElementById("si-list").addEventListener("click", async e => {
  const del = e.target.closest("[data-si-del]");
  if (!del || !EDITING_PRODUCT) return;
  if (!confirm(t("confirm_delete_stock_item"))) return;
  del.disabled = true;
  try {
    await QQ.deleteStockItem(EDITING_PRODUCT.id, del.dataset.siDel);
    await loadStockItems();
    await QQ.syncDigitalStock(EDITING_PRODUCT.id);
  } catch (err) { setMsg("p-msg", QQ.friendlyError(err)); del.disabled = false; }
});

// ---------- รีเซ็ตยอดขาย ----------
document.getElementById("btn-reset-sales").addEventListener("click", async () => {
  if (!confirm(t("confirm_reset_sales"))) return;
  await QQ.setSalesResetPoint(new Date());
  SETTINGS = await QQ.fetchSettings();
  renderOverview();
});

document.getElementById("btn-undo-reset").addEventListener("click", async () => {
  if (!confirm(t("confirm_undo_reset"))) return;
  await QQ.clearSalesResetPoint();
  SETTINGS = await QQ.fetchSettings();
  renderOverview();
});

// ---------- ปุ่มบวก/ลบเครดิตเร็ว ----------
document.querySelector("#credit-overlay .amount-row").addEventListener("click", e => {
  const btn = e.target.closest("[data-amt]");
  if (!btn) return;
  const input = document.getElementById("c-amount");
  input.value = (Number(input.value) || 0) + Number(btn.dataset.amt);
  input.dispatchEvent(new Event("input"));
});

document.getElementById("c-amount").addEventListener("input", () => {
  const amt = Number(document.getElementById("c-amount").value) || 0;
  const before = Number(CREDIT_TARGET?.credit || 0);
  document.getElementById("c-preview").textContent = amt
    ? `${money(before)} → ${money(before + amt)}` : "";
});

document.getElementById("p-image").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try { PRODUCT_IMAGE = await QQ.resizeImage(file, 800, 0.72); IMAGE_CHANGED = true; renderProductPreview(); }
  catch (err) { setMsg("p-msg", err.message || t("error_generic")); }
  finally { e.target.value = ""; }   // เลือกไฟล์เดิมซ้ำต้องทำงานได้อีก
});

document.getElementById("p-image-preview").addEventListener("click", e => {
  if (e.target.id === "p-image-clear") { PRODUCT_IMAGE = null; IMAGE_CHANGED = true; renderProductPreview(); }
});

document.getElementById("c-save").addEventListener("click", async () => {
  const amount = Number(document.getElementById("c-amount").value);
  if (!Number.isFinite(amount) || amount === 0) return setMsg("c-msg", t("amount_invalid"));
  // ใส่ค่าติดลบได้ (ไว้หักคืน) แต่ห้ามหักจนเครดิตติดลบ
  if (amount < 0 && Number(CREDIT_TARGET.credit || 0) + amount < 0) {
    return setMsg("c-msg", t("would_go_negative"));
  }
  const btn = document.getElementById("c-save");
  btn.disabled = true;
  try {
    const uid = CREDIT_TARGET.id;
    const logId = await QQ.adjustCredit(uid, amount, document.getElementById("c-note").value.trim());
    window.closePanel("credit-overlay");
    await refreshAfter(async () => {
      await patchUser(uid);
      if (logId) await patchRow(TOPUPS, "topups", logId);
    });
  } catch (e) { setMsg("c-msg", QQ.friendlyError(e)); }
  finally { btn.disabled = false; }
});

// ปุ่มในตาราง (ใช้ event delegation ตัวเดียวครอบทั้งหน้า)
document.getElementById("dash").addEventListener("click", async e => {
  const btn = e.target.closest("[data-act]");
  if (btn) {
    const { act, id } = btn.dataset;
    btn.disabled = true;
    try {
      if (act === "approve-order" && confirm(t("confirm_approve_order"))) {
        const uid = ORDERS.find(o => o.id === id)?.uid;
        await QQ.approveOrder(id);
        // อนุมัติแล้วสต๊อกเปลี่ยนด้วย จึงต้องดึงรายการสินค้าใหม่
        await refreshAfter(async () => {
          await patchRow(ORDERS, "orders", id);
          await patchUser(uid);
          PRODUCTS = await QQ.fetchProducts();
        });
      } else if (act === "reject-order" && confirm(t("confirm_reject"))) {
        await QQ.rejectOrder(id);
        await refreshAfter(() => patchRow(ORDERS, "orders", id));
      } else if (act === "clear-cust-info" && confirm(t("confirm_clear_customer_info"))) {
        // เติมเกมเสร็จแล้ว ไม่ควรเก็บรหัสผ่านลูกค้าไว้ในระบบต่อ
        await QQ.clearOrderCustomerInfo(id);
        await refreshAfter(() => patchRow(ORDERS, "orders", id));
      } else if (act === "approve-topup") {
        const row = TOPUPS.find(x => x.id === id);
        let amount = null;
        // บอทรับซองสำเร็จแต่บันทึกยอดไม่ทัน = amount เป็น 0
        // ถ้าปล่อยให้กดอนุมัติเลย เครดิตจะเข้า 0 บาทแบบไม่มีใครรู้
        if (!(Number(row?.amount) > 0)) {
          const typed = prompt(t("enter_topup_amount"), "");
          if (typed === null) return;
          amount = Number(typed);
          if (!Number.isFinite(amount) || amount <= 0) return alert(t("amount_invalid"));
        }
        if (!confirm(t("confirm_approve_topup"))) return;
        await QQ.approveTopup(id, amount);
        await refreshAfter(async () => {
          await patchRow(TOPUPS, "topups", id);
          await patchUser(row?.uid);
        });
      } else if (act === "reject-topup" && confirm(t("confirm_reject"))) {
        await QQ.rejectTopup(id);
        await refreshAfter(() => patchRow(TOPUPS, "topups", id));
      } else if (act === "edit-product") {
        const prod = PRODUCTS.find(p => p.id === id);
        // ตารางอาจค้างอยู่หลังสินค้าถูกลบจากอีกหน้าจอ ถ้าไม่กันไว้จะกลายเป็นหน้าต่าง "เพิ่มสินค้า"
        if (!prod) { alert(t("not_found")); await reloadProducts(); return; }
        await openProductModal(prod);
      } else if (act === "add-credit") {
        CREDIT_TARGET = USERS.find(u => u.id === id);
        if (!CREDIT_TARGET) { alert(t("not_found")); await reloadAll(); return; }
        document.getElementById("credit-target").textContent =
          `${CREDIT_TARGET.name || CREDIT_TARGET.email} · ${t("credit")} ${money(CREDIT_TARGET.credit)}`;
        document.getElementById("c-amount").value = "";
        document.getElementById("c-note").value = "";
        document.getElementById("c-preview").textContent = "";
        setMsg("c-msg", "");
        document.getElementById("credit-overlay").classList.add("open");
      } else if (act === "toggle-role") {
        // กันแอดมินถอดสิทธิ์ตัวเองจนเข้าหลังบ้านไม่ได้
        if (id === QQ.user.uid) { alert(t("cannot_demote_self")); return; }
        const u = USERS.find(x => x.id === id);
        if (!u) { alert(t("not_found")); await reloadAll(); return; }
        await QQ.setRole(id, u.role === "admin" ? "member" : "admin");
        await refreshAfter(() => patchUser(id));
      }
    } catch (err) { alert(QQ.friendlyError(err)); }
    finally { btn.disabled = false; }
    return;
  }
  // คลิกรูปสลิปเพื่อดูขนาดเต็ม (รายการเก่าที่ฝังรูปไว้ในเอกสาร)
  const img = e.target.closest(".slip-thumb");
  if (img) {
    document.getElementById("img-full").src = img.src;
    document.getElementById("img-overlay").classList.add("open");
    return;
  }

  // รายการใหม่: โหลดสลิปตอนกดดู
  const slipBtn = e.target.closest("[data-slip]");
  if (slipBtn) {
    const old = slipBtn.textContent;
    slipBtn.disabled = true;
    slipBtn.textContent = t("loading");
    try {
      const data = safeImg(await QQ.fetchTopupSlip(slipBtn.dataset.slip));
      if (!data) { alert(t("slip_load_failed")); return; }
      document.getElementById("img-full").src = data;
      document.getElementById("img-overlay").classList.add("open");
    } catch (err) {
      alert(QQ.friendlyError(err));
    } finally {
      slipBtn.disabled = false;
      slipBtn.textContent = old;
    }
  }
});

document.getElementById("nav-logout").addEventListener("click", () =>
  QQ.logout().then(() => location.href = "login.html"));

document.addEventListener("langchange", () => { if (USERS.length || ORDERS.length) renderAll(); });
let resizeTimer = null;
let lastWidth = window.innerWidth;
window.addEventListener("resize", () => {
  // มือถือยิง resize ทุกครั้งที่แถบที่อยู่ยืด/หด ถ้าวาดกราฟใหม่ทุกครั้งจะกระตุก
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (ORDERS.length || USERS.length) renderOverview();
  }, 200);
});

window.closePanel = id => document.getElementById(id).classList.remove("open");

// ---------- เริ่มทำงาน ----------
function showGate(msgKey, withLogin) {
  document.getElementById("gate").innerHTML = `<div class="gate-box">
      <p>${t(msgKey)}</p>
      ${withLogin ? `<a class="btn-primary" href="login.html?next=admin.html">${t("login")}</a>` : ""}
    </div>`;
  document.getElementById("gate").classList.remove("hidden");
  document.getElementById("dash").classList.add("hidden");
}

(async function boot() {
  if (!QQ.isConfigured) {
    document.getElementById("gate").innerHTML =
      `<div class="gate-box"><p>ยังไม่ได้ตั้งค่า Firebase — แก้ไฟล์ <code>firebase-config.js</code></p></div>`;
    return;
  }
  await QQ.whenAuthReady();
  if (!QQ.user) return showGate("login_title", true);
  if (!QQ.isAdmin) return showGate("access_denied", false);

  document.getElementById("gate").classList.add("hidden");
  document.getElementById("dash").classList.remove("hidden");
  try { await reloadAll(); }
  catch (e) {
    // โหลดข้อมูลไม่ได้ ต้องบอกให้รู้ ไม่ใช่โชว์หน้าเปล่าเหมือนร้านไม่มีลูกค้า
    console.error("โหลดข้อมูลหลังบ้านไม่ได้", e);
    showGate("load_failed", false);
    document.getElementById("gate").insertAdjacentHTML("beforeend",
      `<div class="gate-box"><button class="btn-primary" onclick="location.reload()">${t("try_again")}</button></div>`);
  }
})();
