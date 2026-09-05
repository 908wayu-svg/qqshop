// ===== หน้ากระเป๋าเงิน: เติมเงิน + ประวัติ =====
import { QQ, fetchWithTimeout } from "./auth.js";
import { SHOP, parseAngpaoCode } from "./shop-config.js";
import { promptPayPayload } from "./promptpay.js";

let METHOD = null;
let SLIP_DATA = null;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtDate = d => {
  if (!d) return "—";
  const date = typeof d.toDate === "function" ? d.toDate() : new Date(d);
  return getLang() === "th"
    ? date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })
    : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
};

const statusBadge = s => `<span class="badge ${s}">${t("st_" + s)}</span>`;

function setMsg(text, kind = "error") {
  const el = document.getElementById("msg");
  el.textContent = text;
  el.className = "msg" + (text ? " show " + kind : "");
}

// ---------- ช่องทางเติมเงิน ----------
const METHOD_META = {
  truewallet: { icon: "👛", key: "m_truewallet" },
  angpao: { icon: "🧧", key: "m_angpao" },
  bank: { icon: "🏦", key: "m_bank" },
  promptpay: { icon: "📱", key: "m_promptpay" },
};

function availableMethods() {
  return Object.keys(METHOD_META).filter(k => SHOP.channels[k]?.enabled);
}

function renderMethods() {
  const grid = document.getElementById("method-grid");
  grid.innerHTML = availableMethods().map(k => `
    <button class="method${METHOD === k ? " active" : ""}" data-method="${k}">
      <span class="m-icon">${METHOD_META[k].icon}</span>
      <span>${t(METHOD_META[k].key)}</span>
    </button>`).join("");
}

function renderMethodInfo() {
  const box = document.getElementById("method-info");
  const c = SHOP.channels;
  const row = (label, value, copy) => `
    <div class="info-row">
      <span>${label}</span>
      <b>${esc(value)}${copy ? ` <button class="copy" data-copy="${esc(value)}">⧉</button>` : ""}</b>
    </div>`;

  if (METHOD === "truewallet") {
    box.innerHTML = `<div class="info-card">
      ${row(t("transfer_to"), c.truewallet.phone, true)}
      ${row(t("account_name"), c.truewallet.accountName)}
      <div class="hint">${t("attach_slip_required")}</div>
    </div>`;
  } else if (METHOD === "bank") {
    box.innerHTML = `<div class="info-card">
      ${row(t("transfer_to"), getLang() === "th" ? c.bank.bankName : c.bank.bankNameEn)}
      ${row(t("account_no"), c.bank.accountNo, true)}
      ${row(t("account_name"), c.bank.accountName)}
      <div class="hint">${t("attach_slip_required")}</div>
    </div>`;
  } else if (METHOD === "promptpay") {
    box.innerHTML = `<div class="info-card">
      ${row(t("transfer_to"), c.promptpay.phone, true)}
      <div id="qr-canvas"></div>
      <div class="hint">${t("scan_qr")} · ${t("attach_slip_required")}</div>
    </div>`;
    renderQR();
  } else if (METHOD === "angpao") {
    box.innerHTML = `<div class="info-card">
      ${row(t("transfer_to"), c.angpao.receivePhone, true)}
      <div class="hint">${botEnabled() ? t("angpao_hint") : t("angpao_hint_manual")}</div>
    </div>`;
  } else {
    box.innerHTML = "";
  }

  const isAngpao = METHOD === "angpao";
  // ซองอั่งเปาไม่ต้องแนบสลิป (ใช้ลิงก์แทน)
  document.getElementById("angpao-box").classList.toggle("hidden", !isAngpao);
  document.getElementById("slip-box").classList.toggle("hidden", isAngpao);
  // บอทอ่านยอดเงินจากซองเอง ลูกค้าไม่ต้องกรอก
  document.getElementById("amount-box").classList.toggle("hidden", isAngpao && botEnabled());
  document.getElementById("submit-btn").textContent =
    isAngpao && botEnabled() ? t("angpao_submit") : t("topup_submit");
}

function renderQR() {
  const box = document.getElementById("qr-canvas");
  if (!box) return;
  const amount = Number(document.getElementById("amount").value) || 0;
  const payload = promptPayPayload(SHOP.channels.promptpay.phone, amount, SHOP.name);
  box.innerHTML = "";

  // เบอร์ในไฟล์ตั้งค่าผิดรูปแบบ = ห้ามสร้าง QR มั่วๆ ให้ลูกค้าโอนผิดบัญชี
  if (!payload) { box.innerHTML = `<div class="hint">${t("promptpay_bad_config")}</div>`; return; }
  if (!window.QRCode) { box.innerHTML = `<div class="hint">${t("qr_unavailable")}</div>`; return; }

  new QRCode(box, { text: payload, width: 200, height: 200 });
}

const botEnabled = () => !!SHOP.channels.angpao?.botUrl;

// เรียกบอทให้กดรับซองอั่งเปา แล้วเติมเครดิตอัตโนมัติ
async function redeemAngpaoViaBot(link) {
  const btn = document.getElementById("submit-btn");
  btn.disabled = true;
  setMsg(t("angpao_working"), "warn");
  try {
    const token = await QQ.getIdToken();
    if (!token) { setMsg(t("e_UNAUTHORIZED")); return; }

    const res = await fetchWithTimeout(SHOP.channels.angpao.botUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token, link }),
    });
    const data = await res.json().catch(() => null);
    if (!data) { setMsg(t("e_BOT_UNREACHABLE")); return; }

    if (!data.ok) {
      const key = "e_" + data.error;
      const text = t(key) === key ? (data.error || t("error_generic")) : t(key);
      // รับซองได้แล้วแต่เติมเครดิตไม่สำเร็จ = ไม่ใช่ความผิดลูกค้า และซองใช้ไปแล้ว
      // ต้องล้างช่องลิงก์กับรีเฟรชประวัติ ไม่งั้นลูกค้าจะกดยิงซ้ำเรื่อยๆ
      const claimed = ["CREDIT_PENDING_ADMIN", "CREDIT_FAILED"].includes(data.error);
      setMsg(text, claimed ? "warn" : "error");
      if (claimed) {
        document.getElementById("angpao").value = "";
        await renderHistory();
      }
      return;
    }
    setMsg(`${t("angpao_ok")} +${money(data.amount)}`, "ok");
    document.getElementById("angpao").value = "";
    await renderHistory();
  } catch {
    setMsg(t("e_BOT_UNREACHABLE"));
  } finally {
    btn.disabled = false;
  }
}

// ---------- ส่งคำขอเติมเงิน ----------
async function submitTopup() {
  const amount = Number(document.getElementById("amount").value);
  const btn = document.getElementById("submit-btn");

  if (!METHOD) return setMsg(t("topup_method"));

  // ซองอั่งเปา + มีบอท = กดรับให้เลย ไม่ต้องกรอกยอด ไม่ต้องรออนุมัติ
  if (METHOD === "angpao" && botEnabled()) {
    const link = document.getElementById("angpao").value.trim();
    if (!parseAngpaoCode(link)) return setMsg(t("angpao_invalid"));
    return redeemAngpaoViaBot(link);
  }

  if (!amount || amount < SHOP.topup.min || amount > SHOP.topup.max) {
    return setMsg(`${t("amount_invalid")} (${t("min_amount")} ${money(SHOP.topup.min)})`);
  }

  const payload = { amount, method: METHOD };

  if (METHOD === "angpao") {
    const link = document.getElementById("angpao").value.trim();
    if (!parseAngpaoCode(link)) return setMsg(t("angpao_invalid"));
    payload.angpaoLink = link;
    payload.angpaoCode = parseAngpaoCode(link);
    payload.receivePhone = SHOP.channels.angpao.receivePhone;
  } else {
    if (!SLIP_DATA) return setMsg(t("attach_slip_required"));
    payload.slip = SLIP_DATA;
  }

  btn.disabled = true;
  setMsg("");
  try {
    await QQ.createTopup(payload);
    setMsg(t("topup_sent"), "ok");
    document.getElementById("amount").value = "";
    document.getElementById("angpao").value = "";
    document.getElementById("slip").value = "";
    document.getElementById("slip-preview").innerHTML = "";
    SLIP_DATA = null;
    await renderHistory();
  } catch (e) {
    setMsg(QQ.friendlyError(e));
  } finally {
    btn.disabled = false;
  }
}

// ---------- ประวัติ ----------
async function renderHistory() {
  const tt = document.getElementById("table-topups");
  let topups;
  try { topups = await QQ.fetchMyTopups(); }
  catch (e) {
    console.warn("โหลดประวัติเติมเงินไม่ได้", e);
    tt.innerHTML = `<tr><td class="empty">${t("load_failed")}</td></tr>`;
    return;
  }

  tt.innerHTML = !topups.length
    ? `<tr><td class="empty">${t("no_data")}</td></tr>`
    : `<thead><tr><th>${t("date")}</th><th>${t("method")}</th>
         <th class="num">${t("amount")}</th><th>${t("status")}</th></tr></thead>
       <tbody>${topups.map(x => `<tr>
         <td data-label="${t("date")}">${fmtDate(x.createdAt)}</td>
         <td data-label="${t("method")}">${t(METHOD_META[x.method]?.key || "m_admin")}</td>
         <td class="num" data-label="${t("amount")}">${money(x.amount)}</td>
         <td data-label="${t("status")}">${statusBadge(x.status)}${x.note ? `<br><small>${esc(x.note)}</small>` : ""}</td>
       </tr>`).join("")}</tbody>`;
}

function renderCredit() {
  document.getElementById("credit-big").textContent = money(QQ.credit);
}

// ---------- events ----------
document.getElementById("method-grid").addEventListener("click", e => {
  const btn = e.target.closest(".method");
  if (!btn) return;
  METHOD = btn.dataset.method;
  renderMethods();
  renderMethodInfo();
  setMsg("");
});

document.getElementById("method-info").addEventListener("click", async e => {
  const btn = e.target.closest(".copy");
  if (!btn) return;
  try { await navigator.clipboard.writeText(btn.dataset.copy); btn.textContent = "✓"; }
  catch { /* บางเบราว์เซอร์ไม่รองรับ */ }
  setTimeout(() => { btn.textContent = "⧉"; }, 1200);
});

document.getElementById("amount").addEventListener("input", () => {
  if (METHOD === "promptpay") renderQR();
});

document.getElementById("slip").addEventListener("change", async e => {
  const file = e.target.files[0];
  const prev = document.getElementById("slip-preview");
  if (!file) { SLIP_DATA = null; prev.innerHTML = ""; return; }
  prev.innerHTML = `<span class="hint">${t("loading")}</span>`;
  try {
    SLIP_DATA = await QQ.resizeImage(file, 1000, 0.7);
    prev.innerHTML = `<img src="${SLIP_DATA}" alt="slip">`;
  } catch (err) {
    SLIP_DATA = null;
    prev.innerHTML = "";
    setMsg(err.message || t("error_generic"));
  }
});

document.getElementById("slip-preview").addEventListener("click", e => {
  if (e.target.tagName !== "IMG") return;
  document.getElementById("img-full").src = e.target.src;
  document.getElementById("img-overlay").classList.add("open");
});

document.getElementById("nav-logout").addEventListener("click", () => QQ.logout());
document.addEventListener("langchange", () => {
  renderMethods(); renderMethodInfo(); renderCredit(); renderHistory();
});
document.addEventListener("authchange", () => { if (QQ.user) renderCredit(); });

window.closePanel = id => document.getElementById(id).classList.remove("open");
window.submitTopup = submitTopup;

// ---------- เริ่มทำงาน ----------
(async function boot() {
  if (!QQ.isConfigured) {
    document.getElementById("gate").textContent = "ยังไม่ได้ตั้งค่า Firebase";
    return;
  }
  await QQ.whenAuthReady();
  if (!QQ.user) { location.href = "login.html?next=wallet.html"; return; }

  document.getElementById("gate").classList.add("hidden");
  document.getElementById("page").classList.remove("hidden");
  document.getElementById("nav-logout").classList.remove("hidden");

  METHOD = availableMethods()[0] || null;
  renderMethods();
  renderMethodInfo();
  renderCredit();
  await renderHistory();
})();
