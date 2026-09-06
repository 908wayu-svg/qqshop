// ===== หน้าประวัติการซื้อของลูกค้า =====
import { QQ } from "./auth.js";

let ORDERS = [], PRODUCTS = [], FILTER = "all";
// ดึงประวัติมาได้สูงสุดเท่านี้ต่อครั้ง — ถ้าได้มาเต็มพอดี แปลว่ายังมีของเก่ากว่านั้นอีก
// ต้องบอกลูกค้า ไม่งั้นเขาจะคิดว่ารายการเก่าหายไปจากระบบ และ "ยอดซื้อสะสม" ก็จะดูต่ำกว่าจริง
const HISTORY_MAX = 200;
let CAPPED = false;

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

// รายการที่แอดมินซ่อนไว้ ไม่ต้องโชว์ในหน้าประวัติของลูกค้า
// (เอกสารยังอยู่ครบ ยอดขายหลังบ้านไม่เปลี่ยน — เป็นการซ่อนที่หน้าจอเท่านั้น)
const visible = list => list.filter(o => !o.hiddenAt);

// ===== สถานะออเดอร์ =====
// ระบบใหม่ใช้ 4 สถานะ: pending → processing → completed · หรือ cancelled (คืนเครดิตแล้ว)
// ออเดอร์เก่ายังมี approved / rejected ค้างอยู่ ต้องแสดงผลให้ถูกต่อไปตลอด
const DONE_STATES = ["completed", "approved"];
const OPEN_STATES = ["pending", "processing"];
const VOID_STATES = ["cancelled", "rejected"];
const FILTER_GROUP = { completed: DONE_STATES, pending: OPEN_STATES, cancelled: VOID_STATES };

// เวลาแจ้งเคลม (นาที) มาจาก shop-config.js ที่เดียว
const claimMinutes = () => Number(QQ.SHOP?.policy?.claimMinutes) || 10;

const toMs = ts => {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  const n = new Date(ts).getTime();
  return Number.isFinite(n) ? n : 0;
};

// นับถอยหลังเวลาเคลม — ปัดขึ้นเป็นนาที ลูกค้าจะได้ไม่เห็น "เหลือ 0 นาที" ทั้งที่ยังทันอยู่
function claimBadge(o) {
  const start = toMs(o.claimTimerStartedAt);
  if (!start || !DONE_STATES.includes(o.status)) return "";
  const mins = claimMinutes();
  const leftMs = start + mins * 60000 - Date.now();
  return leftMs > 0
    ? `<div class="claim-left">⏱ ${esc(tv("claim_left", { n: Math.ceil(leftMs / 60000) }))}</div>`
    : `<div class="claim-left over">⏱ ${esc(t("claim_expired"))}</div>`;
}

// ช่องที่ลูกค้ากรอกเองตอนสั่ง (ของเติมเกม) — แก้ได้เฉพาะตอนยัง "รอดำเนินการ"
const EDITABLE = [
  { k: "gameUid", label: "your_game_uid" },
  { k: "gameLogin", label: "your_game_login" },
  { k: "gamePassword", label: "your_game_password" },
];
const editableItems = o => (o.items || [])
  .map((it, index) => ({ it, index }))
  .filter(({ it }) => EDITABLE.some(f => f.k in it));
const canEdit = o => o.status === "pending" && editableItems(o).length > 0;

function render() {
  const group = FILTER_GROUP[FILTER];
  const list = group ? ORDERS.filter(o => group.includes(o.status)) : ORDERS;
  const box = document.getElementById("list");

  // ยอดซื้อสะสมนับเฉพาะที่ซื้อสำเร็จจริง (ที่หักเครดิตแล้วและไม่ได้ยกเลิก)
  const done = ORDERS.filter(o => DONE_STATES.includes(o.status));
  document.getElementById("kpi-spent").textContent =
    money(done.reduce((s, o) => s + Number(o.total || 0), 0))
    + (CAPPED ? " " + tv("spent_capped", { n: HISTORY_MAX }) : "");
  document.getElementById("kpi-count").textContent = done.length.toLocaleString();

  const note = document.getElementById("history-note");
  note.textContent = CAPPED ? tv("history_capped", { n: HISTORY_MAX }) : "";
  note.classList.toggle("hidden", !CAPPED);

  if (!list.length) {
    box.innerHTML = `<div class="card empty-box">
        <p class="empty">${t("no_purchases")}</p>
        <a class="btn-primary" href="index.html">${t("browse_products")}</a>
      </div>`;
    return;
  }

  const noteKey = {
    pending: "pending_note", processing: "processing_note",
    completed: "completed_note", cancelled: "cancelled_note",
    approved: "approved_note", rejected: "rejected_note",
  };
  const doneAt = o => o.completedAt || o.approvedAt || o.cancelledAt;

  box.innerHTML = list.map(o => `
    <article class="purchase">
      <header class="purchase-head">
        <div>
          <span class="order-id">${t("order_number")} ${esc(o.id.slice(0, 8).toUpperCase())}</span>
          <div class="muted">${DONE_STATES.includes(o.status) ? t("purchased_on") : t("ordered_on")}
            ${fmtDate(DONE_STATES.includes(o.status) && doneAt(o) ? doneAt(o) : o.createdAt)}</div>
        </div>
        <span class="badge ${esc(o.status)}">${t("st_" + o.status)}</span>
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

      ${claimBadge(o)}
      ${canEdit(o) ? `<button class="btn-ghost edit-info-btn" data-edit="${esc(o.id)}">
          ✏️ ${t("edit_info")}</button>` : ""}
      ${o.infoEditedAt ? `<div class="muted small">${t("info_edited_at")} ${fmtDate(o.infoEditedAt)}</div>` : ""}

      <footer class="purchase-foot">
        <span class="muted">${t(noteKey[o.status] || "")}${o.note ? ` · ${esc(o.note)}` : ""}</span>
        <b>${money(o.total)}</b>
      </footer>
    </article>`).join("");
  window.watchProductImages?.(box);
}

// ---------- แก้ไขข้อมูลไอดีเกมของตัวเอง ----------
let EDITING = null;   // รหัสออเดอร์ที่กำลังแก้อยู่

function openEdit(orderId) {
  const o = ORDERS.find(x => x.id === orderId);
  if (!o || !canEdit(o)) return;
  EDITING = orderId;

  document.getElementById("edit-list").innerHTML = editableItems(o).map(({ it, index }) => `
    <div class="edit-item" data-index="${index}">
      <div class="ei-name">${esc(itemName(it))}</div>
      ${EDITABLE.filter(f => f.k in it).map(f => `
        <label for="ei-${index}-${f.k}">${t(f.label)} <span class="req">*</span></label>
        <input type="text" id="ei-${index}-${f.k}" data-field="${f.k}"
               autocomplete="off" spellcheck="false" value="${esc(it[f.k] || "")}">`).join("")}
    </div>`).join("");

  setMsg("");
  document.getElementById("edit-overlay").classList.add("open");
}

function setMsg(text, kind = "warn") {
  const el = document.getElementById("edit-msg");
  el.textContent = text;
  el.className = "msg" + (text ? " show " + kind : "");
}

async function saveEdit() {
  const o = ORDERS.find(x => x.id === EDITING);
  if (!o) return;
  const btn = document.getElementById("edit-save");

  const items = [...document.querySelectorAll("#edit-list .edit-item")].map(box => {
    const out = { index: Number(box.dataset.index) };
    box.querySelectorAll("[data-field]").forEach(inp => { out[inp.dataset.field] = inp.value.trim(); });
    return out;
  });
  // ช่องว่างส่งไปก็โดนเซิร์ฟเวอร์ปฏิเสธอยู่ดี บอกตั้งแต่ตรงนี้จะเข้าใจง่ายกว่า
  if (items.some(it => Object.entries(it).some(([k, v]) => k !== "index" && !v))) {
    setMsg(t("fill_customer_info"));
    return;
  }

  btn.disabled = true;
  try {
    await QQ.updateOrderInfo(EDITING, items);
    // ดึงออเดอร์ใบนั้นกลับมาใหม่ ให้หน้าจอตรงกับของจริงเสมอ
    const fresh = await QQ.fetchMyOrders(HISTORY_MAX).catch(() => null);
    if (fresh) { CAPPED = fresh.length >= HISTORY_MAX; ORDERS = visible(fresh); }
    render();
    window.closePanel("edit-overlay");
  } catch (e) {
    const key = "o_" + (e.orderCode || "");
    setMsg(t(key) === key ? QQ.friendlyError(e) : t(key));
    // แอดมินเพิ่งกดเริ่มดำเนินการ = ปุ่มแก้ไขต้องหายไปทันที ไม่ใช่ให้กดซ้ำแล้วพังซ้ำ
    if (e.orderCode === "EDIT_LOCKED") {
      const fresh = await QQ.fetchMyOrders(HISTORY_MAX).catch(() => null);
      if (fresh) { CAPPED = fresh.length >= HISTORY_MAX; ORDERS = visible(fresh); render(); }
    }
  } finally {
    btn.disabled = false;
  }
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
        ${d.login ? `<button class="copy" data-copy="${esc(d.login)}">⧉</button>` : ""}
      </div>
      <div class="cred-row">
        <span>${t("item_password")}</span>
        <b>${esc(d.password) || "—"}</b>
        ${d.password ? `<button class="copy" data-copy="${esc(d.password)}">⧉</button>` : ""}
      </div>
      ${d.note ? `<div class="cred-note">${esc(d.note)}</div>` : ""}
    </div>`).join("");

  document.getElementById("cred-overlay").classList.add("open");
}

document.getElementById("list").addEventListener("click", e => {
  const editBtn = e.target.closest("[data-edit]");
  if (editBtn) { openEdit(editBtn.dataset.edit); return; }
  const li = e.target.closest("[data-open]");
  if (!li) return;
  const [orderId, idx] = li.dataset.open.split("|");
  openCredentials(orderId, Number(idx));
});

document.getElementById("edit-save").addEventListener("click", saveEdit);

// ปุ่มคัดลอก (.copy) จัดการรวมที่ ui.js — มีทางสำรองให้เบราว์เซอร์ที่ใช้ clipboard ไม่ได้

document.getElementById("status-filter").addEventListener("click", e => {
  const btn = e.target.closest(".range-btn");
  if (!btn) return;
  document.querySelectorAll("#status-filter .range-btn")
    .forEach(b => b.classList.toggle("active", b === btn));
  FILTER = btn.dataset.st;
  render();
});

// นับถอยหลังเวลาเคลมต้องขยับเอง ไม่งั้นลูกค้าเปิดหน้าค้างไว้แล้วเห็นตัวเลขเดิมค้างจนเข้าใจผิด
// (unref เพื่อไม่ให้ตัวจับเวลาค้างโปรเซสตอนรันในชุดทดสอบ — ในเบราว์เซอร์ไม่มีเมธอดนี้)
const claimTicker = setInterval(() => {
  if (ORDERS.some(o => DONE_STATES.includes(o.status) && toMs(o.claimTimerStartedAt))) render();
}, 30000);
claimTicker?.unref?.();

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
      QQ.fetchMyOrders(HISTORY_MAX),
      QQ.fetchProducts().catch(() => []),
    ]);
    CAPPED = orders.length >= HISTORY_MAX;
    ORDERS = visible(orders);
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
