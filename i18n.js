// ===== ระบบสองภาษา ไทย / อังกฤษ =====
// วิธีเพิ่มข้อความใหม่: เพิ่ม key ในทั้ง th และ en แล้วใช้ใน HTML ด้วย data-i18n="key"

const I18N = {
  th: {
    // ทั่วไป
    shop_name: "QQSHOP",
    cart: "ตะกร้า",
    login: "เข้าสู่ระบบ",
    logout: "ออกจากระบบ",
    register: "สมัครสมาชิก",
    admin_panel: "หลังบ้าน",
    back_to_shop: "กลับหน้าร้าน",
    loading: "กำลังโหลด...",
    cancel: "ยกเลิก",
    save: "บันทึก",
    close: "ปิด",

    // หน้าร้าน
    cart_title: "ตะกร้าสินค้า",
    cart_empty: "ตะกร้าว่างเปล่า",
    total: "รวมทั้งหมด",
    checkout: "ชำระเงิน",
    add_to_cart: "เพิ่มลงตะกร้า",
    pay_title: "สแกนจ่ายผ่าน PromptPay",
    pay_amount: "ยอดชำระ",
    pay_hint: "เปิดแอปธนาคาร แล้วสแกน QR นี้เพื่อชำระเงิน",
    paid_done: "โอนเงินเรียบร้อยแล้ว",
    thanks: "ขอบคุณสำหรับการสั่งซื้อ! หลังโอนเงินแล้วรบกวนแจ้งสลิปกับทางร้านได้เลยค่ะ",
    order_no: "เลขที่คำสั่งซื้อ",

    // เข้าสู่ระบบ / สมัคร
    login_title: "เข้าสู่ระบบ",
    register_title: "สมัครสมาชิก",
    email: "อีเมล",
    password: "รหัสผ่าน",
    name: "ชื่อ",
    phone: "เบอร์โทร",
    login_btn: "เข้าสู่ระบบ",
    register_btn: "สมัครสมาชิก",
    or: "หรือ",
    continue_google: "เข้าสู่ระบบด้วย Google",
    continue_facebook: "เข้าสู่ระบบด้วย Facebook",
    no_account: "ยังไม่มีบัญชี?",
    have_account: "มีบัญชีแล้ว?",
    forgot_password: "ลืมรหัสผ่าน?",
    reset_sent: "ส่งลิงก์รีเซ็ตรหัสผ่านไปที่อีเมลแล้ว",
    pw_too_short: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร",
    guest_checkout: "สั่งซื้อแบบไม่สมัครสมาชิก",

    // หลังบ้าน
    dashboard: "ภาพรวมร้าน",
    total_sales: "ยอดขายรวม",
    total_orders: "จำนวนออเดอร์",
    total_members: "สมาชิกทั้งหมด",
    avg_order: "ยอดเฉลี่ยต่อออเดอร์",
    sales_over_time: "ยอดขายรายวัน",
    new_members: "สมาชิกใหม่รายวัน",
    top_products: "สินค้าขายดี",
    recent_orders: "ออเดอร์ล่าสุด",
    members_list: "รายชื่อสมาชิก",
    date: "วันที่",
    customer: "ลูกค้า",
    items: "รายการ",
    amount: "ยอดเงิน",
    status: "สถานะ",
    signup_method: "ช่องทางสมัคร",
    joined: "สมัครเมื่อ",
    no_data: "ยังไม่มีข้อมูล",
    access_denied: "คุณไม่มีสิทธิ์เข้าถึงหน้านี้",
    range_7: "7 วันล่าสุด",
    range_30: "30 วันล่าสุด",
    range_90: "90 วันล่าสุด",
    range_all: "ทั้งหมด",
    baht: "฿",
    orders_unit: "ออเดอร์",
    people_unit: "คน",
    status_pending: "รอตรวจสอบ",
    status_paid: "ชำระแล้ว",
  },
  en: {
    shop_name: "QQSHOP",
    cart: "Cart",
    login: "Sign in",
    logout: "Sign out",
    register: "Sign up",
    admin_panel: "Admin",
    back_to_shop: "Back to shop",
    loading: "Loading...",
    cancel: "Cancel",
    save: "Save",
    close: "Close",

    cart_title: "Your cart",
    cart_empty: "Your cart is empty",
    total: "Total",
    checkout: "Checkout",
    add_to_cart: "Add to cart",
    pay_title: "Pay with PromptPay",
    pay_amount: "Amount due",
    pay_hint: "Open your banking app and scan this QR code to pay",
    paid_done: "I've completed the transfer",
    thanks: "Thank you for your order! Please send us your payment slip.",
    order_no: "Order number",

    login_title: "Sign in",
    register_title: "Create an account",
    email: "Email",
    password: "Password",
    name: "Name",
    phone: "Phone",
    login_btn: "Sign in",
    register_btn: "Create account",
    or: "or",
    continue_google: "Continue with Google",
    continue_facebook: "Continue with Facebook",
    no_account: "Don't have an account?",
    have_account: "Already have an account?",
    forgot_password: "Forgot password?",
    reset_sent: "Password reset link sent to your email",
    pw_too_short: "Password must be at least 6 characters",
    guest_checkout: "Check out as guest",

    dashboard: "Dashboard",
    total_sales: "Total sales",
    total_orders: "Orders",
    total_members: "Members",
    avg_order: "Average order value",
    sales_over_time: "Daily sales",
    new_members: "New members per day",
    top_products: "Top products",
    recent_orders: "Recent orders",
    members_list: "Members",
    date: "Date",
    customer: "Customer",
    items: "Items",
    amount: "Amount",
    status: "Status",
    signup_method: "Sign-up method",
    joined: "Joined",
    no_data: "No data yet",
    access_denied: "You don't have permission to view this page",
    range_7: "Last 7 days",
    range_30: "Last 30 days",
    range_90: "Last 90 days",
    range_all: "All time",
    baht: "฿",
    orders_unit: "orders",
    people_unit: "people",
    status_pending: "Pending",
    status_paid: "Paid",
  },
};

const LANG_KEY = "qq_lang";

function getLang() {
  return localStorage.getItem(LANG_KEY) || "th";
}

function setLang(lang) {
  localStorage.setItem(LANG_KEY, lang);
  applyLang();
  document.dispatchEvent(new CustomEvent("langchange", { detail: lang }));
}

function toggleLang() {
  setLang(getLang() === "th" ? "en" : "th");
}

// t("cart") -> ข้อความตามภาษาปัจจุบัน
function t(key) {
  const lang = getLang();
  return (I18N[lang] && I18N[lang][key]) || I18N.th[key] || key;
}

// แปลทุก element ที่มี data-i18n / data-i18n-placeholder
function applyLang() {
  const lang = getLang();
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-lang-label]").forEach(el => {
    el.textContent = lang === "th" ? "EN" : "ไทย";
  });
}

document.addEventListener("DOMContentLoaded", applyLang);
