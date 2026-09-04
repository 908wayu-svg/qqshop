// ===== หน้าหลังบ้าน: ยอดขาย + สถิติสมาชิก =====
import { QQAuth } from "./auth.js";

let ORDERS = [];
let USERS = [];
let RANGE = 30; // วัน หรือ "all"

// ---------- utils ----------
const fmtBaht = n => "฿" + Math.round(n).toLocaleString();
const fmtNum = n => n.toLocaleString();

function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  return new Date(ts);
}
const dayKey = d => d.toISOString().slice(0, 10);

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

// สร้างชุดข้อมูลรายวันแบบเติมวันที่ขาดให้เป็น 0
function dailySeries(records, valueFn) {
  const start = RANGE === "all"
    ? (records.length ? new Date(Math.min(...records.map(r => r._date.getTime()))) : new Date())
    : rangeStart();
  const startDay = new Date(start); startDay.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(0, 0, 0, 0);

  const buckets = new Map();
  for (let d = new Date(startDay); d <= end; d.setDate(d.getDate() + 1)) {
    buckets.set(dayKey(d), 0);
  }
  records.forEach(r => {
    const k = dayKey(r._date);
    if (buckets.has(k)) buckets.set(k, buckets.get(k) + valueFn(r));
  });
  return [...buckets.entries()].map(([key, value]) => ({ key, label: dayLabel(key), value }));
}

// ---------- charts (SVG เขียนเอง) ----------
const CHART_COLORS = { sales: "var(--series-1)", members: "var(--series-2)", products: "var(--series-1)" };

function chartTooltip(box) {
  let tip = box.querySelector(".chart-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tip";
    box.appendChild(tip);
  }
  return tip;
}

function emptyState(box) {
  box.innerHTML = `<div class="chart-empty">${t("no_data")}</div>`;
}

function lineChart(box, data, { color, format }) {
  if (!data.length || data.every(d => d.value === 0)) return emptyState(box);

  const W = Math.max(box.clientWidth || 640, 320), H = 240;
  const P = { t: 16, r: 16, b: 28, l: 52 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const max = Math.max(...data.map(d => d.value)) || 1;
  const niceMax = Math.ceil(max / 4) * 4 || 4;
  const x = i => P.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = v => P.t + ih - (v / niceMax) * ih;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(niceMax * f));
  const grid = ticks.map(v => `
    <line class="grid" x1="${P.l}" y1="${y(v)}" x2="${W - P.r}" y2="${y(v)}"/>
    <text class="axis" x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end">${format(v)}</text>`).join("");

  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(data.length - 1).toFixed(1)},${P.t + ih} L${x(0).toFixed(1)},${P.t + ih} Z`;

  // ป้ายแกน X แสดงแค่บางจุด ไม่ให้ทับกัน
  const step = Math.max(1, Math.ceil(data.length / 6));
  const xLabels = data.map((d, i) =>
    (i % step === 0 || i === data.length - 1)
      ? `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${d.label}</text>` : ""
  ).join("");

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
      ${dots}
      ${xLabels}
      <line class="crosshair" y1="${P.t}" y2="${P.t + ih}" style="display:none"/>
    </svg>`;

  const svg = box.querySelector("svg");
  const tip = chartTooltip(box);
  const cross = svg.querySelector(".crosshair");
  svg.querySelectorAll(".dot").forEach(c => c.style.stroke = "var(--surface-1)");

  svg.addEventListener("mousemove", e => {
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / r.width);
    let i = Math.round(((px - P.l) / iw) * (data.length - 1));
    i = Math.min(data.length - 1, Math.max(0, i));
    const d = data[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
    cross.style.display = "";
    tip.innerHTML = `<b>${d.label}</b><br>${format(d.value)}`;
    tip.style.display = "block";
    const left = (x(i) / W) * r.width;
    tip.style.left = Math.min(Math.max(left, 40), r.width - 40) + "px";
    tip.style.top = ((y(d.value) / H) * r.height - 12) + "px";
  });
  svg.addEventListener("mouseleave", () => { tip.style.display = "none"; cross.style.display = "none"; });
}

function barChart(box, items, { color, format }) {
  if (!items.length) return emptyState(box);

  const rowH = 34, P = { t: 8, r: 90, b: 8, l: 150 };
  const W = Math.max(box.clientWidth || 640, 320);
  const H = P.t + P.b + items.length * rowH;
  const iw = W - P.l - P.r;
  const max = Math.max(...items.map(d => d.value)) || 1;

  const rows = items.map((d, i) => {
    const w = Math.max((d.value / max) * iw, 3);
    const y = P.t + i * rowH + 6;
    const h = rowH - 14;
    return `
      <text class="axis name" x="${P.l - 12}" y="${y + h / 2 + 4}" text-anchor="end">${escapeHtml(d.label)}</text>
      <rect class="bar" x="${P.l}" y="${y}" width="${w}" height="${h}" rx="4" fill="${color}"
            data-label="${escapeHtml(d.label)}" data-value="${format(d.value)}"/>
      <text class="value" x="${P.l + w + 10}" y="${y + h / 2 + 4}">${format(d.value)}</text>`;
  }).join("");

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${rows}</svg>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- ตาราง ----------
function renderOrdersTable(orders) {
  const el = document.getElementById("table-orders");
  if (!orders.length) { el.innerHTML = `<tr><td class="empty">${t("no_data")}</td></tr>`; return; }
  el.innerHTML = `
    <thead><tr>
      <th>${t("date")}</th><th>${t("customer")}</th><th>${t("items")}</th>
      <th class="num">${t("amount")}</th><th>${t("status")}</th>
    </tr></thead>
    <tbody>${orders.slice(0, 20).map(o => `
      <tr>
        <td>${fmtDateTime(o._date)}</td>
        <td>${escapeHtml(o.customerName || "Guest")}<br><small>${escapeHtml(o.customerEmail || "")}</small></td>
        <td><small>${escapeHtml((o.items || []).map(i => `${i.name} x${i.qty}`).join(", "))}</small></td>
        <td class="num">${fmtBaht(o.total || 0)}</td>
        <td><span class="badge ${o.status === "paid" ? "ok" : "pending"}">${o.status === "paid" ? t("status_paid") : t("status_pending")}</span></td>
      </tr>`).join("")}
    </tbody>`;
}

function renderMembersTable(users) {
  const el = document.getElementById("table-members");
  if (!users.length) { el.innerHTML = `<tr><td class="empty">${t("no_data")}</td></tr>`; return; }
  el.innerHTML = `
    <thead><tr>
      <th>${t("name")}</th><th>${t("email")}</th><th>${t("signup_method")}</th><th>${t("joined")}</th>
    </tr></thead>
    <tbody>${users.slice(0, 20).map(u => `
      <tr>
        <td>${escapeHtml(u.name || "—")}${u.role === "admin" ? ' <span class="badge admin">admin</span>' : ""}</td>
        <td>${escapeHtml(u.email || "—")}</td>
        <td><span class="badge provider">${escapeHtml(u.provider || "email")}</span></td>
        <td>${fmtDateTime(u._date)}</td>
      </tr>`).join("")}
    </tbody>`;
}

// ---------- render ทั้งหน้า ----------
function render() {
  const start = rangeStart();
  const orders = ORDERS.filter(o => o._date && o._date >= start);
  const users = USERS.filter(u => u._date && u._date >= start);

  const sales = orders.reduce((s, o) => s + (o.total || 0), 0);
  document.getElementById("kpi-sales").textContent = fmtBaht(sales);
  document.getElementById("kpi-orders").textContent = fmtNum(orders.length);
  document.getElementById("kpi-members").textContent = fmtNum(USERS.length);
  document.getElementById("kpi-avg").textContent = orders.length ? fmtBaht(sales / orders.length) : "—";

  lineChart(document.getElementById("chart-sales"),
    dailySeries(orders, o => o.total || 0), { color: CHART_COLORS.sales, format: fmtBaht });

  lineChart(document.getElementById("chart-members"),
    dailySeries(users, () => 1), { color: CHART_COLORS.members, format: fmtNum });

  // สินค้าขายดี (นับจากยอดเงินรวมของสินค้าแต่ละชิ้น)
  const byProduct = new Map();
  orders.forEach(o => (o.items || []).forEach(i => {
    byProduct.set(i.name, (byProduct.get(i.name) || 0) + (i.price || 0) * (i.qty || 0));
  }));
  const top = [...byProduct.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value).slice(0, 8);
  barChart(document.getElementById("chart-products"), top,
    { color: CHART_COLORS.products, format: fmtBaht });

  renderOrdersTable(orders);
  renderMembersTable(users.length ? users : USERS);
}

// ---------- โหลดข้อมูล + ตรวจสิทธิ์ ----------
function showGate(msgKey) {
  const gate = document.getElementById("gate");
  gate.innerHTML = `<div class="gate-box">
      <p>${t(msgKey)}</p>
      <a class="btn-primary" href="login.html?next=admin.html" data-i18n="login">${t("login")}</a>
    </div>`;
  gate.classList.remove("hidden");
  document.getElementById("dash").classList.add("hidden");
}

async function boot() {
  if (!QQAuth.isConfigured) {
    document.getElementById("gate").innerHTML =
      `<div class="gate-box"><p>ยังไม่ได้ตั้งค่า Firebase — แก้ไฟล์ <code>firebase-config.js</code> ก่อน</p></div>`;
    return;
  }
  await QQAuth.whenAuthReady();
  if (!QQAuth.user) return showGate("login_title");
  if (!QQAuth.isAdmin) return showGate("access_denied");

  document.getElementById("gate").classList.add("hidden");
  document.getElementById("dash").classList.remove("hidden");

  const [orders, users] = await Promise.all([QQAuth.fetchOrders(), QQAuth.fetchUsers()]);
  ORDERS = orders.map(o => ({ ...o, _date: toDate(o.createdAt) })).filter(o => o._date);
  USERS = users.map(u => ({ ...u, _date: toDate(u.createdAt) }));
  render();
}

document.getElementById("range-filter").addEventListener("click", e => {
  const btn = e.target.closest(".range-btn");
  if (!btn) return;
  document.querySelectorAll(".range-btn").forEach(b => b.classList.toggle("active", b === btn));
  RANGE = btn.dataset.range === "all" ? "all" : Number(btn.dataset.range);
  render();
});

document.addEventListener("langchange", () => { if (ORDERS.length || USERS.length) render(); });
window.addEventListener("resize", () => { if (ORDERS.length || USERS.length) render(); });

boot();
