// ===== โหลดรูปสินค้าเฉพาะใบที่เลื่อนมาถึง =====
// รูปสินค้าเก็บแยกที่ productImages/{id} ไม่ได้ฝังอยู่ในเอกสารสินค้า
// ถ้าโหลดมาพร้อมรายการสินค้าทั้งหมด ร้านที่มีของ 60 ชิ้นจะต้องดาวน์โหลด
// เกือบ 10 MB ก่อนเห็นหน้าร้าน — มือถือเน็ตช้าคือค้างยาว

// รูปโปร่งใส 1x1 ใช้กันไอคอนรูปเสียตอนที่ยังโหลดไม่ถึง
const BLANK_IMG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const PRODUCT_IMG_CACHE = new Map();   // id -> Promise<dataURL|null>

const isSafeImage = s =>
  /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(String(s || ""))
    ? String(s) : null;

function loadProductImage(id) {
  if (PRODUCT_IMG_CACHE.has(id)) return PRODUCT_IMG_CACHE.get(id);
  const job = (async () => {
    try { return isSafeImage(await window.QQ.fetchProductImage(id)); }
    catch (e) { console.warn("โหลดรูปสินค้าไม่ได้", e); return null; }
  })();
  PRODUCT_IMG_CACHE.set(id, job);
  return job;
}

// <img data-pimg="รหัสสินค้า"> ทุกตัวในกล่องที่ส่งมา จะโหลดรูปเมื่อเลื่อนมาถึง
function watchProductImages(root) {
  const box = root || document;
  const targets = [...box.querySelectorAll("img[data-pimg]:not([data-pimg-done])")];
  if (!targets.length) return;

  const fill = async el => {
    el.dataset.pimgDone = "1";
    const src = await loadProductImage(el.dataset.pimg);
    if (src) el.src = src; else el.classList.add("img-missing");
  };

  // เบราว์เซอร์เก่าที่ไม่มี IntersectionObserver ก็ยังต้องเห็นรูป
  if (typeof IntersectionObserver !== "function") { targets.forEach(fill); return; }

  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      obs.unobserve(e.target);
      fill(e.target);
    });
  }, { rootMargin: "300px" });
  targets.forEach(el => io.observe(el));
}

window.BLANK_IMG = BLANK_IMG;
window.isSafeImage = isSafeImage;
window.loadProductImage = loadProductImage;
window.watchProductImages = watchProductImages;

// ===== กล่องลอย (overlay): ปิดด้วยปุ่ม Esc / กดพื้นที่มืดรอบๆ =====
// เดิมปิดได้ทางเดียวคือกดกากบาทมุมขวาบน บนมือถือต้องเอื้อมไกล
function closeTopOverlay() {
  const open = [...document.querySelectorAll(".overlay.open")];
  if (!open.length) return false;
  open[open.length - 1].classList.remove("open");
  syncScrollLock();
  return true;
}

// ล็อกไม่ให้หน้าหลังเลื่อนตามตอนกล่องลอยเปิดอยู่
function syncScrollLock() {
  const any = document.querySelector(".overlay.open");
  document.body.style.overflow = any ? "hidden" : "";
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeTopOverlay();
});

document.addEventListener("click", e => {
  // กดโดนพื้นที่มืด (ตัว .overlay เอง ไม่ใช่กล่องข้างใน) = ปิด
  if (!e.target.classList?.contains("overlay") || !e.target.classList.contains("open")) return;
  e.target.classList.remove("open");
  syncScrollLock();
});

// เปิด/ปิดจากโค้ดหน้าอื่นก็ต้องล็อกการเลื่อนให้ถูก
document.addEventListener("DOMContentLoaded", () => {
  if (typeof MutationObserver !== "function") return;
  const watcher = new MutationObserver(syncScrollLock);
  document.querySelectorAll(".overlay").forEach(el =>
    watcher.observe(el, { attributes: true, attributeFilter: ["class"] }));
});

window.closeTopOverlay = closeTopOverlay;
