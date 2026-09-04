// ===== หลังบ้าน: ภาพรวม / ออเดอร์ / เติมเงิน / สินค้า / สมาชิก =====
import { QQ } from "./auth.js";
import { angpaoRedeemUrl } from "./shop-config.js";

let ORDERS = [], USERS = [], TOPUPS = [], PRODUCTS = [];
let RANGE = 30;
let ORDER_FILTER = "pending", TOPUP_FILTER = "pending";
let EDITING_PRODUCT = null, PRODUCT_IMAGE = null, CREDIT_TARGET = null;

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
function renderOverview() {
  const start = rangeStart();
  const inRange = arr => arr.filter(x => x._date && x._date >= start);

  const approved = inRange(ORDERS.filter(o => o.status === "approved"));
  const users = inRange(USERS);
  const sales = approved.reduce((s, o) => s + (o.total || 0), 0);

  const set = (id, v) => { document.getElementById(id).textContent = v; };
  set("kpi-sales", money(sales));
  set("kpi-orders", fmtNum(approved.length));
  set("kpi-avg", approved.length ? money(sales / approved.length) : "—");
  set("kpi-members", fmtNum(USERS.length));
  set("kpi-pending-orders", fmtNum(ORDERS.filter(o => o.status === "pending").length));
  set("kpi-pending-topups", fmtNum(TOPUPS.filter(x => x.status === "pending").length));
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
  pill("pill-orders", ORDERS.filter(o => o.status === "pending").length);
  pill("pill-topups", TOPUPS.filter(x => x.status === "pending").length);
}

// ---------- ออเดอร์ ----------
function renderOrders() {
  const list = ORDER_FILTER === "all" ? ORDERS : ORDERS.filter(o => o.status === ORDER_FILTER);
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
        <td>${fmtDateTime(o._date)}</td>
        <td>${esc(o.customerName || "—")}<br><small>${esc(o.customerEmail || "")}</small>
            <br><small class="credit-note">${t("credit")}: ${money(creditOf(o.uid))}</small></td>
        <td><small>${esc((o.items || []).map(i => `${i.name} ×${i.qty}`).join(", "))}</small></td>
        <td class="num">${money(o.total)}${pc && !pc.ok
          ? `<br><small class="price-warn" title="${t("price_mismatch")}">⚠ ${money(pc.real)}</small>` : ""}</td>
        <td>${statusBadge(o.status)}${o.note ? `<br><small>${esc(o.note)}</small>` : ""}</td>
        <td class="actions">${o.status === "pending" ? `
          <button class="btn-small ok" data-act="approve-order" data-id="${o.id}">${t("approve")}</button>
          <button class="btn-small danger" data-act="reject-order" data-id="${o.id}">${t("reject")}</button>` : ""}
        </td>
      </tr>`;
    }).join("")}</tbody>`;
}

const creditOf = uid => Number(USERS.find(u => u.id === uid)?.credit || 0);

// ยอดเงินในออเดอร์ส่งมาจากเบราว์เซอร์ลูกค้า จึงต้องคิดใหม่จากราคาสินค้าจริงเพื่อกันการแก้ราคา
// คืนค่า null = ตรวจไม่ได้ (สินค้าถูกลบ/เปลี่ยนราคาไปแล้ว)
function priceCheck(order) {
  const items = order.items || [];
  if (!items.length) return null;
  let real = 0;
  for (const i of items) {
    const p = PRODUCTS.find(x => x.id === String(i.id));
    if (!p) return null;
    real += Number(p.price) * Number(i.qty);
  }
  return { real, ok: Math.abs(real - Number(order.total)) < 0.01 };
}

// ---------- เติมเงิน ----------
const METHOD_KEY = { truewallet: "m_truewallet", angpao: "m_angpao", bank: "m_bank", promptpay: "m_promptpay", admin: "m_admin" };

// ช่อง "สลิป" ในตารางเติมเงิน — ค่าทั้งหมดมาจากลูกค้า จึงต้องกรองก่อนแสดง
function slipCell(x) {
  const img = safeImg(x.slip);
  if (img) return `<img class="slip-thumb" src="${img}" alt="slip">`;

  const link = safeLink(angpaoRedeemUrl(x.angpaoLink));
  if (link) return `<a class="btn-small" href="${esc(link)}" target="_blank" rel="noopener">🧧 ${t("open_angpao")}</a>`;

  // มีค่าอยู่แต่ไม่ผ่านการตรวจ = ข้อมูลผิดปกติ แจ้งเตือนแทนที่จะแสดงเฉยๆ
  if (x.slip || x.angpaoLink) return `<span class="badge rejected">${t("bad_attachment")}</span>`;
  return "—";
}

function renderTopups() {
  const list = TOPUP_FILTER === "all" ? TOPUPS : TOPUPS.filter(x => x.status === TOPUP_FILTER);
  const el = document.getElementById("table-topups");
  if (!list.length) { el.innerHTML = `<tr><td class="empty">${t("no_data")}</td></tr>`; return; }

  el.innerHTML = `
    <thead><tr>
      <th>${t("date")}</th><th>${t("customer")}</th><th>${t("method")}</th>
      <th>${t("slip")}</th><th class="num">${t("amount")}</th><th>${t("status")}</th><th></th>
    </tr></thead>
    <tbody>${list.slice(0, 100).map(x => `
      <tr>
        <td>${fmtDateTime(x._date)}</td>
        <td>${esc(x.name || "—")}<br><small>${esc(x.email || "")}</small></td>
        <td>${t(METHOD_KEY[x.method] || "m_admin")}</td>
        <td>${slipCell(x)}</td>
        <td class="num">${money(x.amount)}</td>
        <td>${statusBadge(x.status)}${x.note ? `<br><small>${esc(x.note)}</small>` : ""}</td>
        <td class="actions">${x.status === "pending" ? `
          <button class="btn-small ok" data-act="approve-topup" data-id="${x.id}">${t("approve")}</button>
          <button class="btn-small danger" data-act="reject-topup" data-id="${x.id}">${t("reject")}</button>` : ""}
        </td>
      </tr>`).join("")}</tbody>`;
}

// ---------- สินค้า ----------
function renderProducts() {
  const el = document.getElementById("product-list");
  if (!PRODUCTS.length) { el.innerHTML = `<div class="empty">${t("no_data")}</div>`; return; }

  el.innerHTML = PRODUCTS.map(p => `
    <div class="padmin${p.active === false ? " off" : ""}">
      <div class="padmin-img">${safeImg(p.image)
        ? `<img src="${safeImg(p.image)}" alt="">`
        : `<span class="emoji">${esc(p.emoji) || "🛍️"}</span>`}</div>
      <div class="padmin-body">
        <b>${esc(p.name)}</b>
        <div class="muted">${money(p.price)} · ${t("stock")} ${p.stock ?? "∞"}</div>
        <div class="muted">${p.active === false ? t("inactive") : t("active")}</div>
      </div>
      <button class="btn-small" data-act="edit-product" data-id="${p.id}">${t("edit")}</button>
    </div>`).join("");
}

function openProductModal(product) {
  EDITING_PRODUCT = product;
  PRODUCT_IMAGE = product?.image || null;
  const v = (id, val) => { document.getElementById(id).value = val ?? ""; };
  document.getElementById("product-modal-title").textContent = product ? t("edit_product") : t("add_product");
  v("p-name", product?.name); v("p-name-en", product?.name_en);
  v("p-desc", product?.desc); v("p-desc-en", product?.desc_en);
  v("p-price", product?.price ?? ""); v("p-stock", product?.stock ?? "");
  v("p-emoji", product?.emoji); v("p-image", "");
  document.getElementById("p-active").checked = product ? product.active !== false : true;
  document.getElementById("p-delete").classList.toggle("hidden", !product);
  setMsg("p-msg", "");
  renderProductPreview();
  document.getElementById("product-overlay").classList.add("open");
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
  const data = {
    name: document.getElementById("p-name").value.trim(),
    name_en: document.getElementById("p-name-en").value.trim(),
    desc: document.getElementById("p-desc").value.trim(),
    desc_en: document.getElementById("p-desc-en").value.trim(),
    price: num("p-price") || 0,
    stock: num("p-stock"),
    emoji: document.getElementById("p-emoji").value.trim(),
    image: PRODUCT_IMAGE,
    active: document.getElementById("p-active").checked,
    sort: EDITING_PRODUCT?.sort ?? PRODUCTS.length,
  };
  if (!data.name) return setMsg("p-msg", t("product_name"));
  if (data.price <= 0) return setMsg("p-msg", t("amount_invalid"));

  const btn = document.getElementById("p-save");
  btn.disabled = true;
  try {
    await QQ.saveProduct(EDITING_PRODUCT?.id, data);
    closePanel("product-overlay");
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
        <td>${esc(u.name || "—")}</td>
        <td>${esc(u.email || "—")}</td>
        <td><span class="badge provider">${esc(u.provider || "email")}</span></td>
        <td class="num"><b>${money(u.credit)}</b></td>
        <td>${u.role === "admin" ? `<span class="badge admin">${t("role_admin")}</span>` : t("role_member")}</td>
        <td>${fmtDateTime(u._date)}</td>
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
  const [orders, users, topups, products] = await Promise.all([
    QQ.fetchOrders(), QQ.fetchUsers(), QQ.fetchTopups(), QQ.fetchProducts(),
  ]);
  ORDERS = orders.map(o => ({ ...o, _date: toDate(o.createdAt) }));
  USERS = users.map(u => ({ ...u, _date: toDate(u.createdAt) }));
  TOPUPS = topups.map(x => ({ ...x, _date: toDate(x.createdAt) }));
  PRODUCTS = products;
  renderAll();
}

async function reloadProducts() { PRODUCTS = await QQ.fetchProducts(); renderProducts(); }

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
  await QQ.deleteProduct(EDITING_PRODUCT.id);
  closePanel("product-overlay");
  await reloadProducts();
});

document.getElementById("p-image").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try { PRODUCT_IMAGE = await QQ.resizeImage(file, 900, 0.75); renderProductPreview(); }
  catch (err) { setMsg("p-msg", err.message || t("error_generic")); }
});

document.getElementById("p-image-preview").addEventListener("click", e => {
  if (e.target.id === "p-image-clear") { PRODUCT_IMAGE = null; renderProductPreview(); }
});

document.getElementById("c-save").addEventListener("click", async () => {
  const amount = Number(document.getElementById("c-amount").value);
  if (!Number.isFinite(amount) || amount === 0) return setMsg("c-msg", t("amount_invalid"));
  // ใส่ค่าติดลบได้ (ไว้หักคืน) แต่ห้ามหักจนเครดิตติดลบ
  if (amount < 0 && Number(CREDIT_TARGET.credit || 0) + amount < 0) {
    return setMsg("c-msg", t("insufficient_customer_credit"));
  }
  const btn = document.getElementById("c-save");
  btn.disabled = true;
  try {
    await QQ.addCreditTo(CREDIT_TARGET.id, amount, document.getElementById("c-note").value.trim());
    closePanel("credit-overlay");
    await reloadAll();
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
        await QQ.approveOrder(id); await reloadAll();
      } else if (act === "reject-order" && confirm(t("confirm_reject"))) {
        await QQ.rejectOrder(id); await reloadAll();
      } else if (act === "approve-topup" && confirm(t("confirm_approve_topup"))) {
        await QQ.approveTopup(id); await reloadAll();
      } else if (act === "reject-topup" && confirm(t("confirm_reject"))) {
        await QQ.rejectTopup(id); await reloadAll();
      } else if (act === "edit-product") {
        openProductModal(PRODUCTS.find(p => p.id === id));
      } else if (act === "add-credit") {
        CREDIT_TARGET = USERS.find(u => u.id === id);
        document.getElementById("credit-target").textContent =
          `${t("add_credit_to")} ${CREDIT_TARGET.name || CREDIT_TARGET.email} · ${t("credit")} ${money(CREDIT_TARGET.credit)}`;
        document.getElementById("c-amount").value = "";
        document.getElementById("c-note").value = "";
        setMsg("c-msg", "");
        document.getElementById("credit-overlay").classList.add("open");
      } else if (act === "toggle-role") {
        const u = USERS.find(x => x.id === id);
        await QQ.setRole(id, u.role === "admin" ? "member" : "admin");
        await reloadAll();
      }
    } catch (err) { alert(QQ.friendlyError(err)); }
    finally { btn.disabled = false; }
    return;
  }
  // คลิกรูปสลิปเพื่อดูขนาดเต็ม
  const img = e.target.closest(".slip-thumb");
  if (img) {
    document.getElementById("img-full").src = img.src;
    document.getElementById("img-overlay").classList.add("open");
  }
});

document.getElementById("nav-logout").addEventListener("click", () =>
  QQ.logout().then(() => location.href = "login.html"));

document.addEventListener("langchange", () => { if (USERS.length || ORDERS.length) renderAll(); });
window.addEventListener("resize", () => { if (ORDERS.length || USERS.length) renderOverview(); });

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
  await reloadAll();
})();
