// ===== ปุ่ม "ติดต่อแอดมิน" ลอยมุมจอ + กล่องช่องทางติดต่อ =====
// ใส่ไฟล์นี้ในหน้าไหน หน้านั้นก็มีปุ่มติดต่อทันที (ไม่ต้องแก้ HTML เพิ่ม)
// ช่องทางทั้งหมดแก้ที่ SHOP.contact ใน shop-config.js ที่เดียว
//
// เป็น module เพราะต้อง import ค่าจาก shop-config.js — module ทำงานหลังจาก
// เบราว์เซอร์อ่าน HTML จบแล้ว แต่ยังก่อน DOMContentLoaded จึงมั่นใจได้ว่า
// applyLang() ของ i18n.js จะแปลกล่องนี้ทัน

import { SHOP } from "./shop-config.js";

// รับเฉพาะลิงก์ http/https — กันลิงก์แปลกปลอม (เช่น javascript:) หลุดเข้า href
function safeUrl(u) {
  try {
    const url = new URL(String(u), location.href);
    return (url.protocol === "https:" || url.protocol === "http:") ? url.href : null;
  } catch { return null; }
}

const channels = (SHOP.contact?.channels || [])
  .filter(c => c.enabled !== false && safeUrl(c.url));

// ไม่มีช่องทางที่เปิดใช้ = ไม่ต้องขึ้นปุ่มให้รก
if (channels.length) buildContact();

function buildContact() {
  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "contact-fab";
  fab.id = "contact-fab";
  fab.innerHTML = `<span class="contact-fab-ico" aria-hidden="true">💬</span>` +
    `<span class="contact-fab-text" data-i18n="contact_admin">ติดต่อแอดมิน</span>`;
  fab.addEventListener("click", openContact);

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.id = "contact-overlay";
  overlay.innerHTML = `
    <div class="panel contact-panel" role="dialog" aria-modal="true" aria-labelledby="contact-title">
      <button class="btn-close" type="button" id="contact-close" aria-label="ปิด">×</button>
      <h2 id="contact-title" data-i18n="contact_title">ติดต่อแอดมิน</h2>
      <p class="hint" id="contact-hours"></p>
      <div class="contact-list"></div>
      <p class="hint contact-note" data-i18n="contact_note">แจ้งเลขที่คำสั่งซื้อหรืออีเมลที่สมัครไว้ด้วย จะได้ตรวจให้เร็วขึ้น</p>
    </div>`;

  const list = overlay.querySelector(".contact-list");
  for (const c of channels) {
    const a = document.createElement("a");
    a.className = "contact-item contact-" + (c.id || "other");
    a.href = safeUrl(c.url);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = `<span class="contact-ico" aria-hidden="true"></span>
      <span class="contact-meta"><b></b><small></small></span>
      <span class="contact-go" aria-hidden="true">›</span>`;
    a.querySelector(".contact-ico").textContent = c.icon || "•";
    a.querySelector(".contact-meta b").textContent = c.label || c.id || "";
    a.querySelector(".contact-meta small").textContent = c.detail || "";
    list.appendChild(a);
  }

  overlay.querySelector("#contact-close").addEventListener("click", closeContact);

  document.body.appendChild(fab);
  document.body.appendChild(overlay);
  // บอก CSS ว่าหน้านี้มีปุ่มลอย จะได้เว้นที่ท้ายหน้าไม่ให้ปุ่มบังของแถวสุดท้าย
  document.body.classList.add("has-contact-fab");
  syncHours();
  document.addEventListener("langchange", syncHours);
}

// เวลาทำการเก็บอยู่ใน shop-config.js ไม่ใช่ในตารางคำแปล จึงต้องสลับภาษาเอง
function syncHours() {
  const el = document.getElementById("contact-hours");
  if (!el) return;
  const th = SHOP.contact?.hours || "";
  const en = SHOP.contact?.hoursEn || th;
  el.textContent = (typeof getLang === "function" && getLang() === "en") ? en : th;
  el.classList.toggle("hidden", !el.textContent);
}

function openContact() {
  const o = document.getElementById("contact-overlay");
  if (!o) return;
  o.classList.add("open");
  // ui.js ดูแลการปิดด้วย Esc / กดพื้นที่มืด และล็อกการเลื่อนหน้าหลังให้เอง
  o.querySelector("#contact-close")?.focus();
}

function closeContact() {
  document.getElementById("contact-overlay")?.classList.remove("open");
  document.getElementById("contact-fab")?.focus();
}

window.openContact = openContact;
window.closeContact = closeContact;
