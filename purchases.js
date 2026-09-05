// ===== หน้าประวัติการซื้อของลูกค้า =====
import { QQ } from "./auth.js";

let ORDERS = [], PRODUCTS = [], FILTER = "all";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtDate(ts) {
  if (!ts) return "—";
  const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
  return getLang() === "th"
    ? d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

// อนุญาตเฉพาะรูปแบบ data: ของจริงเท่านั้น
const safeImg = s =>
  /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(String(s || ""))
    ? String(s) : null;

// หารูปสินค้าจากคลังปัจจุบัน (สินค้าอาจถูกลบไปแล้ว จึงต้องมีตัวสำรอง)
function itemThumb(item) {
  const p = PRODUCTS.find(x => x.id === String(item.id));
  const img = safeImg(p?.image);
  if (img) return `<img src="${img}" alt="">`;
  if (p?.hasImage) return `<img class="lazy" data-pimg="${esc(p.id)}" src="${window.BLANK_IMG}" alt="">`;
  return `<span class="emoji">${esc(p?.emoji) || "🛍️"}</span>`;
}

function itemName(item) {
  const p = PRODUCTS.find(x => x.id === String(item.id));
  return (getLang() === "en" && p?.name_en) || item.name || p?.name || "—";
}

function render() {
  const list = FILTER === "all" ? ORDERS : ORDERS.filter(o => o.status === FILTER);
  const box = document.getElementById("list");

  // ยอดซื้อสะสมนับเฉพาะที่อนุมัติแล้ว (ที่หักเครดิตไปจริง)
  const done = ORDERS.filter(o => o.status === "approved");
  document.getElementById("kpi-spent").textContent =
    money(done.reduce((s, o) => s + Number(o.total || 0), 0));
  document.getElementById("kpi-count").textContent = done.length.toLocaleString();

  if (!list.length) {
    box.innerHTML = `<div class="card empty-box">
        <p class="empty">${t("no_purchases")}</p>
        <a class="btn-primary" href="index.html">${t("browse_products")}</a>
      </div>`;
    return;
  }

  const noteKey = { pending: "pending_note", approved: "approved_note", rejected: "rejected_note" };

  box.innerHTML = list.map(o => `
    <article class="purchase">
      <header class="purchase-head">
        <div>
          <span class="order-id">${t("order_number")} ${esc(o.id.slice(0, 8).toUpperCase())}</span>
          <div class="muted">${o.status === "approved" ? t("purchased_on") : t("ordered_on")}
            ${fmtDate(o.status === "approved" && o.approvedAt ? o.approvedAt : o.createdAt)}</div>
        </div>
        <span class="badge ${o.status}">${t("st_" + o.status)}</span>
      </header>

      <ul class="purchase-items">
        ${(o.items || []).map((i, idx) => {
          const has = Array.isArray(i.delivered) && i.delivered.length;
          return `
          <li class="${has ? "has-delivery" : ""}" ${has ? `data-open="${o.id}|${idx}"` : ""}>
            <div class="pi-thumb">${itemThumb(i)}</div>
            <div class="pi-body">
              <b>${esc(itemName(i))}</b>
              <div class="muted">${money(i.price)} × ${i.qty}</div>
              ${has ? `<div class="pi-open">🔑 ${t("view_credentials")}</div>` : ""}
            </div>
            <div class="pi-sum">${money(Number(i.price) * Number(i.qty))}</div>
          </li>`;
        }).join("")}
      </ul>

      <footer class="purchase-foot">
        <span class="muted">${t(noteKey[o.status] || "")}${o.note ? ` · ${esc(o.note)}` : ""}</span>
        <b>${money(o.total)}</b>
      </footer>
    </article>`).join("");
  window.watchProductImages?.(box);
}

// ---------- กล่องแสดงไอดี/รหัสผ่านที่ซื้อมา ----------
function openCredentials(orderId, itemIdx) {
  const order = ORDERS.find(o => o.id === orderId);
  const item = order?.items?.[itemIdx];
  if (!item?.delivered?.length) return;

  document.getElementById("cred-title").textContent = itemName(item);
  document.getElementById("cred-list").innerHTML = item.delivered.map((d, n) => `
    <div class="cred-card">
      ${item.delivered.length > 1 ? `<div class="cred-no">${t("set_no")} ${n + 1}</div>` : ""}
      <div class="cred-row">
        <span>${t("item_login")}</span>
        <b>${esc(d.login) || "—"}</b>
        <button class="copy" data-copy="${esc(d.login)}">⧉</button>
      </div>
      <div class="cred-row">
        <span>${t("item_password")}</span>
        <b>${esc(d.password) || "—"}</b>
        <button class="copy" data-copy="${esc(d.password)}">⧉</button>
      </div>
      ${d.note ? `<div class="cred-note">${esc(d.note)}</div>` : ""}
    </div>`).join("");

  document.getElementById("cred-overlay").classList.add("open");
}

document.getElementById("list").addEventListener("click", e => {
  const li = e.target.closest("[data-open]");
  if (!li) return;
  const [orderId, idx] = li.dataset.open.split("|");
  openCredentials(orderId, Number(idx));
});

// ปุ่มคัดลอก (.copy) จัดการรวมที่ ui.js — มีทางสำรองให้เบราว์เซอร์ที่ใช้ clipboard ไม่ได้

document.getElementById("status-filter").addEventListener("click", e => {
  const btn = e.target.closest(".range-btn");
  if (!btn) return;
  document.querySelectorAll("#status-filter .range-btn")
    .forEach(b => b.classList.toggle("active", b === btn));
  FILTER = btn.dataset.st;
  render();
});

window.closePanel = id => document.getElementById(id).classList.remove("open");
document.getElementById("nav-logout").addEventListener("click", () => QQ.logout());
document.addEventListener("langchange", () => { if (ORDERS.length) render(); });
document.addEventListener("authchange", () => {
  if (QQ.user) document.getElementById("nav-credit-amount").textContent = money(QQ.credit);
});

(async function boot() {
  if (!QQ.isConfigured) {
    document.getElementById("gate").textContent = "ยังไม่ได้ตั้งค่า Firebase";
    return;
  }
  await QQ.whenAuthReady();
  if (!QQ.user) { location.href = "login.html?next=purchases.html"; return; }

  document.getElementById("gate").classList.add("hidden");
  document.getElementById("page").classList.remove("hidden");
  document.getElementById("nav-credit-amount").textContent = money(QQ.credit);

  // รูปสินค้าดึงมาเสริม ถ้าดึงไม่ได้ก็ยังแสดงประวัติได้ตามปกติ
  try {
    const [orders, products] = await Promise.all([
      QQ.fetchMyOrders(200),
      QQ.fetchProducts().catch(() => []),
    ]);
    ORDERS = orders;
    PRODUCTS = products;
    render();
  } catch (e) {
    // เน็ตหลุด/โหลดไม่ได้ ต้องบอกลูกค้า ไม่ใช่ปล่อยหน้าว่างเปล่าให้งง
    console.warn("โหลดประวัติไม่ได้", e);
    document.getElementById("list").innerHTML =
      `<div class="card empty-box"><p class="empty">${t("load_failed")}</p>
        <button class="btn-primary" onclick="location.reload()">${t("try_again")}</button></div>`;
  }
})();
