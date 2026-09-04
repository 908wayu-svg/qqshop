// ===== ระบบสองภาษา ไทย / อังกฤษ =====
// วิธีเพิ่มข้อความใหม่: เพิ่ม key ในทั้ง th และ en แล้วใช้ใน HTML ด้วย data-i18n="key"

const I18N = {
  th: {
    // ทั่วไป
    cart: "ตะกร้า", login: "เข้าสู่ระบบ", logout: "ออกจากระบบ", register: "สมัครสมาชิก",
    admin_panel: "หลังบ้าน", back_to_shop: "กลับหน้าร้าน", loading: "กำลังโหลด...",
    cancel: "ยกเลิก", save: "บันทึก", close: "ปิด", edit: "แก้ไข", delete: "ลบ",
    add: "เพิ่ม", confirm: "ยืนยัน", search: "ค้นหา", all: "ทั้งหมด", baht: "฿",
    saved: "บันทึกแล้ว", error_generic: "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง",

    // หน้าร้าน
    cart_title: "ตะกร้าสินค้า", cart_empty: "ตะกร้าว่างเปล่า", total: "รวมทั้งหมด",
    checkout: "สั่งซื้อ", add_to_cart: "เพิ่มลงตะกร้า", out_of_stock: "สินค้าหมด",
    stock_left: "เหลือ", order_no: "เลขที่คำสั่งซื้อ",
    order_placed: "สั่งซื้อเรียบร้อย! รอแอดมินอนุมัติ เครดิตจะถูกหักเมื่ออนุมัติแล้ว",
    login_required: "กรุณาเข้าสู่ระบบก่อนสั่งซื้อ",
    not_enough_credit: "เครดิตไม่พอ กรุณาเติมเงินก่อน",
    cart_updated: "ราคาหรือจำนวนสินค้าในตะกร้ามีการเปลี่ยนแปลง กรุณาตรวจสอบแล้วกดสั่งซื้ออีกครั้ง",
    topup_now: "เติมเงิน",
    o_PRODUCT_NOT_FOUND: "มีสินค้าในตะกร้าที่ไม่มีขายแล้ว ระบบเอาออกให้แล้ว",
    o_PRODUCT_INACTIVE: "มีสินค้าในตะกร้าที่ปิดขายไปแล้ว",
    o_OUT_OF_STOCK: "สินค้าบางรายการมีไม่พอ กรุณาลดจำนวนลง",
    o_NOT_ENOUGH_CREDIT: "เครดิตไม่พอ กรุณาเติมเงินก่อน",
    o_EMPTY_CART: "ตะกร้าว่างเปล่า",
    o_BAD_QTY: "จำนวนสินค้าไม่ถูกต้อง",
    o_BAD_ITEM: "ข้อมูลสินค้าไม่ถูกต้อง",
    o_RATE_LIMITED: "สั่งซื้อถี่เกินไป กรุณารอสักครู่",
    o_UNAUTHORIZED: "กรุณาเข้าสู่ระบบใหม่",
    o_BOT_UNREACHABLE: "ติดต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่",


    // กระเป๋าเงิน / เติมเงิน
    wallet: "กระเป๋าเงิน", my_credit: "เครดิตของฉัน", credit: "เครดิต",
    topup_title: "เติมเงิน", topup_amount: "จำนวนเงินที่เติม", topup_method: "ช่องทางเติมเงิน",
    topup_submit: "ส่งคำขอเติมเงิน",
    topup_sent: "ส่งคำขอแล้ว รอแอดมินอนุมัติ เครดิตจะเข้าหลังอนุมัติ",
    attach_slip: "แนบภาพสลิป", attach_slip_required: "ต้องแนบภาพสลิปทุกครั้ง",
    slip: "สลิป", choose_image: "เลือกรูป", change_image: "เปลี่ยนรูป",
    m_truewallet: "ทรูมันนี่ วอลเล็ต", m_angpao: "ซองอั่งเปา ทรูมันนี่",
    m_bank: "โอนผ่านธนาคาร", m_promptpay: "พร้อมเพย์ (QR)", m_admin: "แอดมินเพิ่มให้",
    angpao_link: "ลิงก์ซองอั่งเปา",
    angpao_hint: "วางลิงก์ซองแล้วกดส่ง ระบบจะกดรับให้อัตโนมัติ เครดิตเข้าทันทีไม่ต้องรออนุมัติ",
    angpao_hint_manual: "วางลิงก์ซองอั่งเปาที่นี่ ระบบจะส่งให้แอดมินกดรับ",
    angpao_invalid: "ลิงก์ซองอั่งเปาไม่ถูกต้อง",
    angpao_submit: "รับซองอั่งเปา",
    angpao_working: "กำลังกดรับซอง...",
    angpao_ok: "รับซองสำเร็จ! เครดิตเข้าแล้ว",
    // ข้อความผิดพลาดจากทรูมันนี่
    e_ALREADY_USED: "ซองนี้ถูกใช้ไปแล้ว",
    e_VOUCHER_NOT_FOUND: "ไม่พบซองนี้ ลิงก์อาจผิดหรือถูกยกเลิก",
    e_VOUCHER_OUT_OF_STOCK: "ซองนี้ถูกคนอื่นรับไปหมดแล้ว",
    e_VOUCHER_EXPIRED: "ซองนี้หมดอายุแล้ว",
    e_VOUCHER_HAS_BEEN_USED: "ซองนี้ถูกใช้ไปแล้ว",
    e_TARGET_USER_REDEEMED: "เบอร์ร้านรับซองนี้ไปแล้ว",
    e_CANNOT_GET_OWN_VOUCHER: "รับซองของตัวเองไม่ได้",
    e_INVALID_LINK: "ลิงก์ซองอั่งเปาไม่ถูกต้อง",
    e_UNAUTHORIZED: "กรุณาเข้าสู่ระบบใหม่",
    e_INTERNAL_ERROR: "ทรูมันนี่ขัดข้องชั่วคราว ลองใหม่อีกครั้ง",
    e_BOT_UNREACHABLE: "ติดต่อระบบรับซองไม่ได้ ลองใหม่หรือแจ้งแอดมิน",
    e_RATE_LIMITED: "ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
    transfer_to: "โอนเข้า", account_name: "ชื่อบัญชี", account_no: "เลขที่บัญชี",
    scan_qr: "สแกน QR เพื่อโอน",
    purchases: "ประวัติการซื้อ", my_purchases: "ประวัติการซื้อของฉัน",
    no_purchases: "ยังไม่เคยซื้อสินค้า", browse_products: "เลือกดูสินค้า",
    order_number: "เลขที่", order_items: "สินค้าที่ซื้อ", qty_short: "จำนวน",
    purchased_on: "ซื้อเมื่อ", ordered_on: "สั่งเมื่อ",
    total_spent: "ยอดซื้อสะสม", purchase_count: "จำนวนครั้งที่ซื้อ",
    pending_note: "รอแอดมินอนุมัติ เครดิตจะถูกหักเมื่ออนุมัติแล้ว",
    approved_note: "ซื้อสำเร็จ หักเครดิตเรียบร้อย",
    rejected_note: "ไม่อนุมัติ เครดิตไม่ถูกหัก",
    view_all_purchases: "ดูประวัติการซื้อทั้งหมด",
    topup_history: "ประวัติเติมเงิน", order_history: "ประวัติการสั่งซื้อ",
    min_amount: "จำนวนเงินขั้นต่ำ", amount_invalid: "จำนวนเงินไม่ถูกต้อง",

    // สถานะ
    status: "สถานะ", st_pending: "รออนุมัติ", st_approved: "อนุมัติแล้ว", st_rejected: "ไม่อนุมัติ",
    approve: "อนุมัติ", reject: "ไม่อนุมัติ", approved_by: "อนุมัติโดย",

    // เข้าสู่ระบบ
    login_title: "เข้าสู่ระบบ", register_title: "สมัครสมาชิก", email: "อีเมล",
    password: "รหัสผ่าน", name: "ชื่อ", phone: "เบอร์โทร",
    login_btn: "เข้าสู่ระบบ", register_btn: "สมัครสมาชิก", or: "หรือ",
    continue_google: "เข้าสู่ระบบด้วย Google", continue_facebook: "เข้าสู่ระบบด้วย Facebook",
    forgot_password: "ลืมรหัสผ่าน?", reset_sent: "ส่งลิงก์รีเซ็ตรหัสผ่านไปที่อีเมลแล้ว",
    pw_too_short: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร",
    enter_email_first: "กรุณากรอกอีเมลก่อน",
    browse_shop: "ดูสินค้าก่อน",

    // หลังบ้าน
    dashboard: "ภาพรวม", tab_orders: "ออเดอร์", tab_topups: "เติมเงิน",
    tab_products: "สินค้า", tab_members: "สมาชิก",
    total_sales: "ยอดขาย (อนุมัติแล้ว)", total_orders: "ออเดอร์ที่อนุมัติ",
    total_members: "สมาชิกทั้งหมด", avg_order: "ยอดเฉลี่ยต่อออเดอร์",
    pending_orders: "ออเดอร์รออนุมัติ", pending_topups: "เติมเงินรออนุมัติ",
    total_credit: "เครดิตคงเหลือรวม",
    sales_over_time: "ยอดขายรายวัน", new_members: "สมาชิกใหม่รายวัน",
    top_products: "สินค้าขายดี", recent_orders: "ออเดอร์ล่าสุด", members_list: "รายชื่อสมาชิก",
    date: "วันที่", customer: "ลูกค้า", items: "รายการ", amount: "ยอดเงิน",
    signup_method: "ช่องทางสมัคร", joined: "สมัครเมื่อ", no_data: "ยังไม่มีข้อมูล",
    access_denied: "คุณไม่มีสิทธิ์เข้าถึงหน้านี้",
    range_7: "7 วัน", range_30: "30 วัน", range_90: "90 วัน", range_all: "ทั้งหมด",
    orders_unit: "ออเดอร์", people_unit: "คน",
    method: "ช่องทาง", view_slip: "ดูสลิป", open_angpao: "เปิดลิงก์ซอง",
    confirm_approve_order: "อนุมัติออเดอร์นี้? เครดิตลูกค้าจะถูกหักทันที",
    confirm_reject: "ไม่อนุมัติรายการนี้?",
    confirm_approve_topup: "อนุมัติการเติมเงินนี้? เครดิตจะเข้าบัญชีลูกค้าทันที",
    insufficient_customer_credit: "เครดิตลูกค้าไม่พอ อนุมัติไม่ได้",
    price_mismatch: "ยอดเงินไม่ตรงกับราคาสินค้าปัจจุบัน — ตัวเลขสีส้มคือยอดที่ถูกต้อง",
    price_uncheckable: "มีสินค้าที่ไม่มีอยู่ในระบบแล้ว ตรวจยอดอัตโนมัติไม่ได้ กรุณาตรวจเอง",
    check_manually: "ตรวจเอง",
    bad_attachment: "ไฟล์แนบผิดปกติ",

    // จัดการสินค้า
    add_product: "เพิ่มสินค้า", edit_product: "แก้ไขสินค้า", product_name: "ชื่อสินค้า",
    product_name_en: "ชื่อสินค้า (อังกฤษ)", product_desc: "คำอธิบาย",
    product_desc_en: "คำอธิบาย (อังกฤษ)", price: "ราคา", stock: "สต๊อก",
    product_image: "รูปสินค้า", active: "เปิดขาย", inactive: "ปิดขาย",
    confirm_delete_product: "ลบสินค้านี้?", image_too_big: "ไฟล์รูปใหญ่เกินไป",

    // จัดการสมาชิก
    add_credit: "เพิ่มเครดิต", add_credit_to: "เพิ่มเครดิตให้", credit_amount: "จำนวนเครดิต",
    make_admin: "ตั้งเป็นแอดมิน", remove_admin: "ถอดสิทธิ์แอดมิน", cannot_demote_self: "ถอดสิทธิ์แอดมินของตัวเองไม่ได้",
    role: "สิทธิ์", role_admin: "แอดมิน", role_member: "สมาชิก",
    note: "หมายเหตุ", note_optional: "หมายเหตุ (ไม่บังคับ)",
  },

  en: {
    cart: "Cart", login: "Sign in", logout: "Sign out", register: "Sign up",
    admin_panel: "Admin", back_to_shop: "Back to shop", loading: "Loading...",
    cancel: "Cancel", save: "Save", close: "Close", edit: "Edit", delete: "Delete",
    add: "Add", confirm: "Confirm", search: "Search", all: "All", baht: "฿",
    saved: "Saved", error_generic: "Something went wrong, please try again",

    cart_title: "Your cart", cart_empty: "Your cart is empty", total: "Total",
    checkout: "Place order", add_to_cart: "Add to cart", out_of_stock: "Out of stock",
    stock_left: "left", order_no: "Order number",
    order_placed: "Order placed! Waiting for admin approval — credit is deducted on approval.",
    login_required: "Please sign in before ordering",
    not_enough_credit: "Not enough credit. Please top up first.",
    cart_updated: "Prices or quantities in your cart changed — please review and order again.",
    topup_now: "Top up",
    o_PRODUCT_NOT_FOUND: "Your cart had a product that is no longer sold — it has been removed",
    o_PRODUCT_INACTIVE: "Your cart has a product that is no longer listed",
    o_OUT_OF_STOCK: "Not enough stock for some items — please reduce the quantity",
    o_NOT_ENOUGH_CREDIT: "Not enough credit. Please top up first.",
    o_EMPTY_CART: "Your cart is empty",
    o_BAD_QTY: "Invalid quantity",
    o_BAD_ITEM: "Invalid product data",
    o_RATE_LIMITED: "Too many orders — please wait a moment",
    o_UNAUTHORIZED: "Please sign in again",
    o_BOT_UNREACHABLE: "Can not reach the server — please try again",


    wallet: "Wallet", my_credit: "My credit", credit: "Credit",
    topup_title: "Top up", topup_amount: "Amount", topup_method: "Payment method",
    topup_submit: "Submit top-up request",
    topup_sent: "Request submitted. Credit will be added once an admin approves.",
    attach_slip: "Attach payment slip", attach_slip_required: "A payment slip is required",
    slip: "Slip", choose_image: "Choose image", change_image: "Change image",
    m_truewallet: "TrueMoney Wallet", m_angpao: "TrueMoney Angpao link",
    m_bank: "Bank transfer", m_promptpay: "PromptPay (QR)", m_admin: "Added by admin",
    angpao_link: "Angpao link",
    angpao_hint: "Paste the angpao link and submit — it's redeemed automatically and credit lands right away",
    angpao_hint_manual: "Paste your TrueMoney angpao link — an admin will redeem it",
    angpao_invalid: "That angpao link doesn't look valid",
    angpao_submit: "Redeem angpao",
    angpao_working: "Redeeming...",
    angpao_ok: "Redeemed! Credit has been added.",
    e_ALREADY_USED: "This angpao has already been used",
    e_VOUCHER_NOT_FOUND: "Angpao not found — the link may be wrong or cancelled",
    e_VOUCHER_OUT_OF_STOCK: "This angpao has already been fully claimed",
    e_VOUCHER_EXPIRED: "This angpao has expired",
    e_VOUCHER_HAS_BEEN_USED: "This angpao has already been used",
    e_TARGET_USER_REDEEMED: "The shop has already claimed this angpao",
    e_CANNOT_GET_OWN_VOUCHER: "You can't redeem your own angpao",
    e_INVALID_LINK: "That angpao link doesn't look valid",
    e_UNAUTHORIZED: "Please sign in again",
    e_INTERNAL_ERROR: "TrueMoney is temporarily unavailable, please try again",
    e_BOT_UNREACHABLE: "Can't reach the redeem service — try again or contact an admin",
    e_RATE_LIMITED: "Too many attempts — please wait a moment and try again",
    transfer_to: "Transfer to", account_name: "Account name", account_no: "Account number",
    scan_qr: "Scan the QR to pay",
    purchases: "Purchases", my_purchases: "My purchases",
    no_purchases: "You haven't bought anything yet", browse_products: "Browse products",
    order_number: "Order", order_items: "Items", qty_short: "Qty",
    purchased_on: "Purchased", ordered_on: "Ordered",
    total_spent: "Total spent", purchase_count: "Purchases",
    pending_note: "Waiting for admin approval — credit is deducted on approval",
    approved_note: "Purchase complete, credit deducted",
    rejected_note: "Rejected — no credit was deducted",
    view_all_purchases: "View all purchases",
    topup_history: "Top-up history", order_history: "Order history",
    min_amount: "Minimum amount", amount_invalid: "Invalid amount",

    status: "Status", st_pending: "Pending", st_approved: "Approved", st_rejected: "Rejected",
    approve: "Approve", reject: "Reject", approved_by: "Approved by",

    login_title: "Sign in", register_title: "Create an account", email: "Email",
    password: "Password", name: "Name", phone: "Phone",
    login_btn: "Sign in", register_btn: "Create account", or: "or",
    continue_google: "Continue with Google", continue_facebook: "Continue with Facebook",
    forgot_password: "Forgot password?", reset_sent: "Password reset link sent to your email",
    pw_too_short: "Password must be at least 6 characters",
    enter_email_first: "Please enter your email first",
    browse_shop: "Browse the shop",

    dashboard: "Overview", tab_orders: "Orders", tab_topups: "Top-ups",
    tab_products: "Products", tab_members: "Members",
    total_sales: "Sales (approved)", total_orders: "Approved orders",
    total_members: "Members", avg_order: "Average order value",
    pending_orders: "Orders awaiting approval", pending_topups: "Top-ups awaiting approval",
    total_credit: "Outstanding credit",
    sales_over_time: "Daily sales", new_members: "New members per day",
    top_products: "Top products", recent_orders: "Recent orders", members_list: "Members",
    date: "Date", customer: "Customer", items: "Items", amount: "Amount",
    signup_method: "Sign-up method", joined: "Joined", no_data: "No data yet",
    access_denied: "You don't have permission to view this page",
    range_7: "7 days", range_30: "30 days", range_90: "90 days", range_all: "All time",
    orders_unit: "orders", people_unit: "people",
    method: "Method", view_slip: "View slip", open_angpao: "Open angpao link",
    confirm_approve_order: "Approve this order? The customer's credit will be deducted now.",
    confirm_reject: "Reject this item?",
    confirm_approve_topup: "Approve this top-up? Credit will be added to the customer now.",
    insufficient_customer_credit: "Customer doesn't have enough credit",
    price_mismatch: "Total doesn't match current product prices — the orange figure is the correct total",
    price_uncheckable: "Contains a product no longer in the catalogue — verify this order by hand",
    check_manually: "check by hand",
    bad_attachment: "Suspicious attachment",

    add_product: "Add product", edit_product: "Edit product", product_name: "Product name",
    product_name_en: "Product name (English)", product_desc: "Description",
    product_desc_en: "Description (English)", price: "Price", stock: "Stock",
    product_image: "Product image", active: "Listed", inactive: "Hidden",
    confirm_delete_product: "Delete this product?", image_too_big: "Image file is too large",

    add_credit: "Add credit", add_credit_to: "Add credit to", credit_amount: "Credit amount",
    make_admin: "Make admin", remove_admin: "Remove admin", cannot_demote_self: "You can not remove your own admin rights",
    role: "Role", role_admin: "Admin", role_member: "Member",
    note: "Note", note_optional: "Note (optional)",
  },
};

const LANG_KEY = "qq_lang";

function getLang() { return localStorage.getItem(LANG_KEY) || "th"; }

function setLang(lang) {
  localStorage.setItem(LANG_KEY, lang);
  applyLang();
  document.dispatchEvent(new CustomEvent("langchange", { detail: lang }));
}

function toggleLang() { setLang(getLang() === "th" ? "en" : "th"); }

// t("cart") -> ข้อความตามภาษาปัจจุบัน
function t(key) {
  const lang = getLang();
  return (I18N[lang] && I18N[lang][key]) || I18N.th[key] || key;
}

// จัดรูปแบบเงินบาท — โชว์ทศนิยมเฉพาะตอนที่มีเศษจริง (ซองอั่งเปาอาจได้ 25.50 บาท)
function money(n) {
  const v = Number(n) || 0;
  const digits = Number.isInteger(v) ? 0 : 2;
  return "฿" + v.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// แปลทุก element ที่มี data-i18n / data-i18n-placeholder
function applyLang() {
  const lang = getLang();
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll("[data-lang-label]").forEach(el => { el.textContent = lang === "th" ? "EN" : "ไทย"; });
}

document.addEventListener("DOMContentLoaded", applyLang);
