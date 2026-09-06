// ===== ระบบสมาชิก + ข้อมูลทั้งหมด (Firebase Auth + Firestore) =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, updateProfile,
  GoogleAuthProvider, FacebookAuthProvider, signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection,
  serverTimestamp, query, orderBy, where, getDocs, limit, onSnapshot, writeBatch, deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./firebase-config.js";
import { SHOP, CATEGORIES } from "./shop-config.js";

// เส้นทางฝั่งเซิร์ฟเวอร์ (Cloudflare Worker ตัวเดียวกับบอทรับซอง)
const API_BASE = (SHOP.channels.angpao?.botUrl || "").replace(/\/$/, "");
const ORDER_API = API_BASE + "/order";

// ===== สิทธิ์แอดมิน =====
// ไม่มีรายชื่ออีเมลในโค้ดอีกแล้ว — ใครเป็นแอดมินดูจาก custom claim `admin: true`
// ที่ติดมากับโทเคนของ Firebase Auth ซึ่งตั้งได้จากเซิร์ฟเวอร์เท่านั้น
// (ตั้ง/ถอดผ่าน /admin/role · ครั้งแรกตั้งด้วย /admin/bootstrap + รหัสลับ)
//
// เดิมใครยึดอีเมลในลิสต์ได้ = เป็นแอดมินทันที และลิสต์ต้องแก้ให้ตรงกัน 2 ที่
// (auth.js + firestore.rules) ลืมที่ใดที่หนึ่งคือช่องโหว่
let currentClaims = {};

let app, auth, db;
if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

let currentUser = null;
let currentProfile = null;
let profileUnsub = null;
let authReady = false;
const readyWaiters = [];

function emit() {
  document.dispatchEvent(new CustomEvent("authchange", {
    detail: { user: currentUser, profile: currentProfile },
  }));
}

// สร้างเอกสารสมาชิกครั้งแรก
async function upsertUserDoc(user, extra = {}) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    // onAuthStateChanged มักสร้างเอกสารให้ก่อนที่ registerWithEmail จะทำงานเสร็จ
    // ถ้าไม่เติมค่าที่ผู้ใช้กรอกไว้ ชื่อกับเบอร์ที่พิมพ์ตอนสมัครจะหายไปเฉยๆ
    const cur = snap.data();
    const patch = {};
    if (extra.name && extra.name !== cur.name) patch.name = extra.name;
    if (extra.phone && extra.phone !== cur.phone) patch.phone = extra.phone;
    if (!Object.keys(patch).length) return cur;
    await updateDoc(ref, patch);
    return { ...cur, ...patch };
  }

  const pid = user.providerData[0]?.providerId || "password";
  const data = {
    uid: user.uid,
    email: user.email || "",
    name: extra.name || user.displayName || (user.email || "").split("@")[0],
    phone: extra.phone || user.phoneNumber || "",
    provider: pid === "password" ? "email" : pid.replace(".com", ""),
    role: "member",
    credit: 0,
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, data);
  return data;
}

// อ่านสิทธิ์ที่ติดมากับโทเคน
// ถ้าเอกสารสมาชิกบอกว่าเป็นแอดมินแล้วแต่โทเคนยังไม่รู้ (เพิ่งได้รับสิทธิ์
// โทเคนใบเดิมมีอายุถึง 1 ชั่วโมง) ให้ขอโทเคนใบใหม่ทันทีหนึ่งครั้ง
async function readClaims(user, profile) {
  try {
    let r = await user.getIdTokenResult();
    if (r.claims?.admin !== true && profile?.role === "admin") {
      r = await user.getIdTokenResult(true);
    }
    return r.claims || {};
  } catch { return {}; }
}

if (isConfigured) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (profileUnsub) { profileUnsub(); profileUnsub = null; }

    if (user) {
      try { await upsertUserDoc(user); } catch (e) { console.warn("สร้างโปรไฟล์ไม่สำเร็จ", e); }
      // ติดตามเครดิตแบบเรียลไทม์ — เครดิตเข้าปุ๊บหน้าเว็บอัปเดตปั๊บ
      profileUnsub = onSnapshot(doc(db, "users", user.uid),
        snap => { currentProfile = snap.data() || null; if (authReady) emit(); },
        err => console.warn("ติดตามโปรไฟล์ไม่ได้", err));
      try {
        const s = await getDoc(doc(db, "users", user.uid));
        currentProfile = s.data() || null;
      } catch { /* onSnapshot จะเติมให้เอง */ }
      currentClaims = await readClaims(user, currentProfile);
    } else {
      currentProfile = null;
      currentClaims = {};
    }

    authReady = true;
    readyWaiters.splice(0).forEach(fn => fn());
    emit();
  });
}

function whenAuthReady() {
  if (!isConfigured || authReady) return Promise.resolve();
  return new Promise(resolve => readyWaiters.push(resolve));
}

function friendlyError(err) {
  const th = getLang() === "th";
  const map = {
    "auth/invalid-email": th ? "รูปแบบอีเมลไม่ถูกต้อง" : "Invalid email address",
    "auth/email-already-in-use": th ? "อีเมลนี้ถูกใช้สมัครแล้ว" : "This email is already registered",
    "auth/weak-password": th ? "รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัว)" : "Password is too weak (min 6 characters)",
    "auth/invalid-credential": th ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : "Wrong email or password",
    "auth/wrong-password": th ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : "Wrong email or password",
    "auth/user-not-found": th ? "ไม่พบบัญชีนี้" : "No account found",
    "auth/too-many-requests": th ? "ลองมากเกินไป กรุณารอสักครู่" : "Too many attempts, please wait",
    "auth/popup-closed-by-user": th ? "ปิดหน้าต่างก่อนเข้าสู่ระบบสำเร็จ" : "Sign-in window was closed",
    "auth/account-exists-with-different-credential":
      th ? "อีเมลนี้เคยสมัครด้วยช่องทางอื่น ลองเข้าสู่ระบบด้วยช่องทางเดิม"
         : "This email is registered with a different sign-in method",
    "auth/operation-not-allowed":
      th ? "ยังไม่ได้เปิดใช้ช่องทางนี้ใน Firebase Console"
         : "This sign-in method is not enabled in Firebase Console",
    "permission-denied": th ? "ไม่มีสิทธิ์ทำรายการนี้" : "You don't have permission to do that",
  };
  return map[err?.code] || err?.message || String(err);
}

// ย่อรูปให้เล็กพอเก็บใน Firestore (จำกัด 1MB ต่อเอกสาร)
function resizeImage(file, maxSide = 800, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t("file_read_failed")));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(t("not_an_image")));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        let out = c.toDataURL("image/jpeg", quality);
        // ถ้ายังใหญ่ไป ลดคุณภาพลงอีก
        for (let q = quality; out.length > 400000 && q > 0.3; q -= 0.12) {
          out = c.toDataURL("image/jpeg", q);
        }
        out.length > 700000 ? reject(new Error(t("image_too_big"))) : resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

// ชิ้นในคลังที่ยังไม่ได้กรอกอะไรเลย ถือเป็นร่าง ยังขายไม่ได้
const stockStatus = d => (String(d?.login || "").trim() || String(d?.password || "").trim())
  ? "available" : "draft";

// เรียกเซิร์ฟเวอร์แบบมีเพดานเวลา (30 วิ) กันหน้าจอค้างเมื่อเน็ตมีปัญหา
export function fetchWithTimeout(url, opt = {}, ms = 30000) {
  if (typeof AbortSignal?.timeout !== "function") return fetch(url, opt);
  return fetch(url, { ...opt, signal: AbortSignal.timeout(ms) });
}

// เงินคิดเป็นทศนิยม 2 ตำแหน่งเสมอ กัน 0.1+0.2 = 0.30000000000000004
const money2 = n => Math.round((Number(n) || 0) * 100) / 100;

// รายการที่ "ยังไม่ถูกตัดสิน" — processing คือรายการที่บอทค้างกลางทาง
const OPEN_STATES = ["pending", "processing"];

// เรียงใหม่ไปเก่า (รองรับ createdAt ที่ยังเขียนไม่เสร็จ = null)
const stamp = x => x?.createdAt?.toMillis?.() ?? 0;
const sortByCreatedDesc = list => list.sort((a, b) => stamp(b) - stamp(a));

// ดึงเฉพาะรายการของตัวเอง เรียงใหม่ไปเก่า
// ต้องมี where("uid") ตั้งแต่ต้น ไม่งั้นกฎความปลอดภัยปฏิเสธทั้งคำสั่ง
// ถ้า composite index ยังไม่พร้อม (deploy ใหม่ๆ) ให้ถอย orderBy ออกแทนที่จะพังทั้งหน้า
async function myQuery(col, max) {
  const base = [collection(db, col), where("uid", "==", currentUser.uid)];
  try {
    return await getDocs(query(...base, orderBy("createdAt", "desc"), limit(max)));
  } catch (e) {
    if (e?.code !== "failed-precondition") throw e;
    console.warn("ยังไม่มี index สำหรับ " + col + " — เรียงเองชั่วคราว", e);
    return await getDocs(query(...base, limit(max)));
  }
}

// ---------- เรียกเส้นทางแอดมินที่เซิร์ฟเวอร์ ----------
// ทุกคำสั่งที่แตะเครดิตหรือสิทธิ์ต้องผ่านทางนี้ เพราะกฎของ Firestore ปิดไม่ให้
// เบราว์เซอร์เขียน credit/role ของใครเลย (รวมถึงแอดมินเอง)
// เซิร์ฟเวอร์ตรวจสิทธิ์ซ้ำอีกรอบจากบัญชีจริง แล้วบันทึกลง adminLogs ทุกครั้ง
async function callAdmin(path, payload = {}) {
  if (!API_BASE) throw new Error(t("a_SERVER_NOT_SET"));
  const idToken = await auth?.currentUser?.getIdToken();
  if (!idToken) throw new Error(t("a_UNAUTHORIZED"));

  const res = await fetchWithTimeout(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, ...payload }),
  }).catch(() => null);

  const data = res
    ? await res.json().catch(() => ({ ok: false, error: "BOT_UNREACHABLE" }))
    : { ok: false, error: "BOT_UNREACHABLE" };

  if (!data.ok) {
    const code = String(data.error || "ADMIN_FAILED");
    // t() คืนชื่อคีย์กลับมาถ้าไม่มีคำแปล — รหัสใหม่ที่ยังไม่ได้แปลจะโผล่เป็น "a_XXX" ให้ผู้ใช้เห็น
    // กันไว้ด้วยการถอยไปใช้ข้อความกลางแทน
    const msg = t("a_" + code);
    throw Object.assign(new Error(msg === "a_" + code ? t("a_ADMIN_FAILED") : msg),
      { adminCode: code });
  }
  return data;
}

export const QQ = {
  isConfigured,
  CATEGORIES,   // หมวดหมู่สินค้า — app.js (สคริปต์ธรรมดา) อ่านผ่าน window.QQ.CATEGORIES
  SHOP,         // ตั้งค่าร้าน (เงื่อนไขเคลม ฯลฯ) — สคริปต์ธรรมดาอ่านผ่าน window.QQ.SHOP
  get user() { return currentUser; },
  get profile() { return currentProfile; },
  get credit() { return Number(currentProfile?.credit || 0); },
  // เป็นแอดมินก็ต่อเมื่อโทเคนมี claim admin:true เท่านั้น
  // เอกสาร users/{uid}.role = 'admin' อย่างเดียวไม่พอ และแก้เองก็ไม่ได้ (กฎปิดไว้)
  get isAdmin() { return currentClaims?.admin === true; },
  get claims() { return { ...currentClaims }; },

  // ขอโทเคนใบใหม่แล้วอ่านสิทธิ์ใหม่ (ใช้ตอนเพิ่งถูกตั้ง/ถอดสิทธิ์)
  async refreshClaims() {
    if (!auth?.currentUser) return {};
    try {
      const r = await auth.currentUser.getIdTokenResult(true);
      currentClaims = r.claims || {};
    } catch { /* ขอใหม่ไม่ได้ก็ใช้ของเดิมไปก่อน */ }
    return { ...currentClaims };
  },

  whenAuthReady, friendlyError, resizeImage,
  getIdToken: () => auth.currentUser?.getIdToken(),

  // ---------- บัญชี ----------
  async registerWithEmail(email, password, name, phone) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (name) await updateProfile(cred.user, { displayName: name });
    await upsertUserDoc(cred.user, { name, phone });
    return cred.user;
  },
  loginWithEmail: (email, password) => signInWithEmailAndPassword(auth, email, password),
  async loginWithGoogle() {
    const c = await signInWithPopup(auth, new GoogleAuthProvider());
    await upsertUserDoc(c.user); return c.user;
  },
  async loginWithFacebook() {
    const c = await signInWithPopup(auth, new FacebookAuthProvider());
    await upsertUserDoc(c.user); return c.user;
  },
  resetPassword: email => sendPasswordResetEmail(auth, email),
  logout: () => signOut(auth),

  // ---------- สินค้า ----------
  // ไม่ใช้ orderBy("sort") เพราะ Firestore จะ "ตัดทิ้ง" สินค้าที่ไม่มีฟิลด์ sort ไปเลย
  // ดึงทั้งหมดแล้วเรียงเองปลอดภัยกว่า
  async fetchProducts() {
    const snap = await getDocs(collection(db, "products"));
    return rows(snap).sort((a, b) =>
      (a.sort ?? Number.MAX_SAFE_INTEGER) - (b.sort ?? Number.MAX_SAFE_INTEGER)
      || String(a.name || "").localeCompare(String(b.name || "")));
  },
  // รูปสินค้าเก็บแยกเอกสาร (เหมือนสลิป) — หน้าร้านจะได้ไม่ต้องโหลดรูปทุกใบ
  // พร้อมกันตอนเปิดเว็บ ร้านที่มีสินค้า 60 ชิ้นเคยต้องโหลดเกือบ 10 MB ก่อนเห็นอะไรเลย
  // data.image = undefined แปลว่า "ไม่ได้แตะรูป" จะไม่เขียนทับของเดิม
  async saveProduct(id, data) {
    const { image, ...rest } = data;
    const ref = id ? doc(db, "products", id) : doc(collection(db, "products"));

    if (image !== undefined) {
      if (image) await setDoc(doc(db, "productImages", ref.id), { image, updatedAt: serverTimestamp() });
      else await deleteDoc(doc(db, "productImages", ref.id)).catch(() => {});
    }

    const payload = { ...rest };
    if (image !== undefined) {
      payload.hasImage = !!image;
      if (id) payload.image = deleteField();     // ล้างรูปแบบเก่าที่ฝังอยู่ในเอกสาร
    }

    if (id) await updateDoc(ref, { ...payload, updatedAt: serverTimestamp() });
    else await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
    return ref;
  },

  async fetchProductImage(productId) {
    const s = await getDoc(doc(db, "productImages", productId));
    return s.exists() ? (s.data().image || null) : null;
  },

  async deleteProduct(id) {
    // ต้องล้างคลังไอดี/รหัสผ่านก่อน — Firestore ไม่ลบ subcollection ตามให้
    // ถ้าไม่ล้าง รหัสผ่านของลูกค้าจะค้างอยู่ในฐานข้อมูลตลอดไปแบบมองไม่เห็น
    const items = await getDocs(collection(db, "products", id, "stockItems"));
    for (let i = 0; i < items.docs.length; i += 400) {
      const batch = writeBatch(db);
      items.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, "products", id));
    await deleteDoc(doc(db, "productImages", id)).catch(() => {});
  },

  // ---------- คลังสินค้าดิจิทัล (ไอดี/รหัสผ่านรายชิ้น) ----------
  // เก็บเป็น subcollection ของสินค้า อ่านได้เฉพาะแอดมิน
  async fetchStockItems(productId) {
    const snap = await getDocs(collection(db, "products", productId, "stockItems"));
    return rows(snap).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  },

  saveStockItem(productId, itemId, data) {
    const col = collection(db, "products", productId, "stockItems");
    return itemId
      ? updateDoc(doc(col, itemId), { ...data, status: stockStatus(data), updatedAt: serverTimestamp() })
      : addDoc(col, { ...data, status: stockStatus(data), createdAt: serverTimestamp() });
  },

  deleteStockItem: (productId, itemId) =>
    deleteDoc(doc(db, "products", productId, "stockItems", itemId)),

  // บันทึกหลายชิ้นพร้อมกัน (Firestore รับได้ 500 การเขียนต่อ 1 batch)
  async saveStockItemsBulk(productId, changes) {
    const col = collection(db, "products", productId, "stockItems");
    for (let i = 0; i < changes.length; i += 400) {
      const batch = writeBatch(db);
      changes.slice(i, i + 400).forEach(c =>
        batch.update(doc(col, c.id),
          { ...c.data, status: stockStatus(c.data), updatedAt: serverTimestamp() }));
      await batch.commit();
    }
  },

  // จำนวนคงเหลือของสินค้าดิจิทัล = จำนวนชิ้นที่ยังไม่ถูกขาย
  // เขียนกลับลงฟิลด์ stock เพื่อให้หน้าร้านและเซิร์ฟเวอร์ใช้ตัวเลขเดียวกัน
  async syncDigitalStock(productId) {
    const items = await QQ.fetchStockItems(productId);

    // ของเก่าที่เคยบันทึกเป็น available ทั้งที่ยังไม่ได้กรอกอะไร ต้องแก้ให้เป็นร่าง
    // ไม่งั้นหน้าร้านโชว์ว่ามีของ แต่ลูกค้าซื้อไปได้ไอดีว่างเปล่า
    const broken = items.filter(i => i.status === "available" && stockStatus(i) === "draft");
    if (broken.length) {
      // ต้องแบ่งเป็นชุดเหมือนที่อื่น — Firestore รับได้ 500 การเขียนต่อ 1 batch
      // ถ้าของพังพร้อมกันเกิน 500 ชิ้น แล้วยิงรวดเดียวจะพังทั้งคำสั่ง
      const col = collection(db, "products", productId, "stockItems");
      for (let i = 0; i < broken.length; i += 400) {
        const batch = writeBatch(db);
        broken.slice(i, i + 400).forEach(it => {
          batch.update(doc(col, it.id), { status: "draft" });
          it.status = "draft";
        });
        await batch.commit();
      }
    }

    const available = items.filter(i => i.status === "available").length;
    await updateDoc(doc(db, "products", productId), { stock: available });
    return available;
  },

  // ---------- ออเดอร์ ----------
  // สั่งซื้อผ่านเซิร์ฟเวอร์ ส่งไปแค่รหัสสินค้ากับจำนวน
  // ราคา/ยอดรวม/สต๊อก/เครดิต ตรวจและคิดที่ฝั่งเซิร์ฟเวอร์ทั้งหมด ลูกค้าแก้ไม่ได้
  async createOrder(items) {
    // เซสชันอาจหมดอายุระหว่างที่ลูกค้าเปิดหน้าค้างไว้ ต้องบอกให้เข้าสู่ระบบใหม่
    // ไม่ใช่ปล่อยให้พังเป็นข้อความภาษาโปรแกรมที่ลูกค้าอ่านไม่รู้เรื่อง
    const idToken = await auth?.currentUser?.getIdToken();
    if (!idToken) throw Object.assign(new Error(t("o_UNAUTHORIZED")), { orderCode: "UNAUTHORIZED" });

    // มีเพดานเวลา ไม่งั้นเน็ตหลุดกลางทางแล้วปุ่มสั่งซื้อค้างไปเรื่อยๆ
    const res = await fetchWithTimeout(ORDER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken,
        // ข้อมูลไอดีเกมของลูกค้าส่งไปด้วย (เฉพาะสินค้าที่แอดมินติ๊กว่าต้องขอ)
        // เซิร์ฟเวอร์ตรวจซ้ำเองว่าสินค้านั้นขอจริงไหม ก่อนบันทึกลงออเดอร์
        items: items.map(i => ({
          id: i.id, qty: i.qty,
          ...(i.gameUid ? { gameUid: i.gameUid } : {}),
          ...(i.gameLogin ? { gameLogin: i.gameLogin } : {}),
          ...(i.gamePassword ? { gamePassword: i.gamePassword } : {}),
        })),
      }),
    }).catch(() => null);
    const data = res
      ? await res.json().catch(() => ({ ok: false, error: "BOT_UNREACHABLE" }))
      : { ok: false, error: "BOT_UNREACHABLE" };
    if (!data.ok) throw Object.assign(new Error(data.error), { orderCode: data.error });
    return data;
  },
  // อ่านทีละเอกสาร (หลังบ้านใช้รีเฟรชเฉพาะแถวที่เพิ่งกด ไม่ต้องโหลดใหม่ทั้งตาราง)
  async fetchOne(col, id) {
    const s = await getDoc(doc(db, col, id));
    return s.exists() ? { id: s.id, ...s.data() } : null;
  },
  async fetchOrders(max = 500) {
    return rows(await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(max))));
  },
  // ต้องกรองด้วย where ให้ Firestore ตั้งแต่ต้น ไม่งั้นกฎความปลอดภัยจะปฏิเสธทั้งคำสั่ง
  async fetchMyOrders(max = 50) {
    return sortByCreatedDesc(rows(await myQuery("orders", max)));
  },

  // ลูกค้าแก้ไอดีเกม/UID ในออเดอร์ของตัวเอง (ได้เฉพาะตอนสถานะ "รอดำเนินการ")
  // ต้องผ่านเซิร์ฟเวอร์เหมือนตอนสั่งซื้อ — กฎ Firestore ปิดไม่ให้เบราว์เซอร์เขียน orders เลย
  // items = [{ index, gameUid?, gameLogin?, gamePassword? }]
  async updateOrderInfo(orderId, items) {
    const idToken = await auth?.currentUser?.getIdToken();
    if (!idToken) throw Object.assign(new Error(t("o_UNAUTHORIZED")), { orderCode: "UNAUTHORIZED" });

    const res = await fetchWithTimeout(ORDER_API + "/edit-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, orderId, items }),
    }).catch(() => null);
    const data = res
      ? await res.json().catch(() => ({ ok: false, error: "BOT_UNREACHABLE" }))
      : { ok: false, error: "BOT_UNREACHABLE" };
    if (!data.ok) throw Object.assign(new Error(data.error), { orderCode: data.error });
    return data;
  },

  // อนุมัติออเดอร์ = หักเครดิต + ตัดสต๊อก + ส่งมอบไอดี/รหัสผ่าน + เปลี่ยนสถานะ
  // ทำที่เซิร์ฟเวอร์ทั้งหมดใน transaction เดียว (เบราว์เซอร์แตะเครดิตเองไม่ได้แล้ว)
  // *** ใช้กับออเดอร์เก่าที่ค้างอยู่ก่อนเปลี่ยนเป็นระบบหักเครดิตตอนสั่งเท่านั้น ***
  approveOrder: orderId => callAdmin("/admin/order/approve", { orderId }),

  // ออเดอร์ระบบใหม่: รอดำเนินการ → กำลังดำเนินการ → สำเร็จ · หรือยกเลิกแล้วคืนเครดิต
  startOrder: orderId => callAdmin("/admin/order/start", { orderId }),
  completeOrder: orderId => callAdmin("/admin/order/complete", { orderId }),
  cancelOrder: (orderId, note = "") => callAdmin("/admin/order/cancel", { orderId, note }),

  // ต้องเช็คสถานะก่อนเสมอ — ถ้าเผลอกด "ไม่อนุมัติ" ทับออเดอร์ที่อนุมัติไปแล้ว
  // เครดิตที่หักไปกับของที่ส่งมอบไปแล้วจะไม่ถูกคืน แต่ประวัติกลับขึ้นว่าไม่อนุมัติ
  // (เซิร์ฟเวอร์เช็คให้ใน transaction)
  rejectOrder: (orderId, note = "") => callAdmin("/admin/order/reject", { orderId, note }),

  // ---------- เติมเงิน ----------
  async createTopup(data) {
    const { slip, ...rest } = data;
    const ref = doc(collection(db, "topups"));
    // เขียนสลิปก่อน ถ้าพลาดจะไม่มีคำขอค้างแบบไม่มีหลักฐานแนบ
    if (slip) {
      await setDoc(doc(db, "topupSlips", ref.id), {
        uid: currentUser.uid, slip, createdAt: serverTimestamp(),
      });
    }
    await setDoc(ref, {
      ...rest,
      hasSlip: !!slip,
      uid: currentUser.uid,
      name: currentProfile?.name || "",
      email: currentUser.email || "",
      status: "pending",
      createdAt: serverTimestamp(),
    });
    return ref;
  },

  // สลิปโหลดตอนแอดมินกดดูเท่านั้น (เอกสารเดียว ไม่ใช่ทั้งตาราง)
  async fetchTopupSlip(topupId) {
    const s = await getDoc(doc(db, "topupSlips", topupId));
    return s.exists() ? (s.data().slip || null) : null;
  },
  async fetchTopups(max = 500) {
    return rows(await getDocs(query(collection(db, "topups"), orderBy("createdAt", "desc"), limit(max))));
  },
  async fetchMyTopups(max = 50) {
    return sortByCreatedDesc(rows(await myQuery("topups", max)));
  },

  // อนุมัติเติมเงิน = เพิ่มเครดิตให้ลูกค้า + เปลี่ยนสถานะ (ทำที่เซิร์ฟเวอร์)
  // amountOverride ใช้กับรายการที่บอทบันทึกยอดไม่ทัน (amount = 0)
  // ถ้าไม่บังคับให้ใส่ยอด แอดมินจะกดอนุมัติแล้วเครดิตเข้า 0 บาทแบบเงียบๆ
  approveTopup: (topupId, amountOverride = null) =>
    callAdmin("/admin/topup/approve", { topupId, amount: amountOverride }),

  // เช็คสถานะก่อนเช่นกัน กัน "ไม่อนุมัติ" ทับรายการที่เติมเครดิตไปแล้ว
  rejectTopup: (topupId, note = "") => callAdmin("/admin/topup/reject", { topupId, note }),

  // ---------- สมาชิก (แอดมิน) ----------
  // ห้ามใส่ orderBy("createdAt") ที่นี่ — สมาชิกที่สมัครไว้ก่อนจะมีฟิลด์นี้
  // จะถูก Firestore ตัดทิ้งเงียบๆ ทั้งจากรายชื่อ ยอดสมาชิก และเครดิตคงเหลือรวม
  // (กฎเหล็กข้อ 5) จำนวนสมาชิกไม่เยอะ เรียงเองใน JS ปลอดภัยกว่า
  async fetchUsers(max = 500) {
    return sortByCreatedDesc(rows(await getDocs(query(collection(db, "users"), limit(max)))));
  },
  // แอดมินปรับเครดิตให้ใครก็ได้ ใส่ค่าติดลบ = หักคืน (บันทึกไว้ในประวัติด้วย)
  // ทำที่เซิร์ฟเวอร์ใน transaction: อ่านยอดปัจจุบัน -> เช็คว่าหักแล้วไม่ติดลบ -> เขียน
  // เบราว์เซอร์เขียนฟิลด์ credit เองไม่ได้แล้ว ต่อให้เป็นแอดมิน
  async adjustCredit(uid, amount, note = "") {
    const r = await callAdmin("/admin/credit", { uid, amount, note });
    return r.logId;
  },

  // ---------- ตั้งค่าร้าน ----------
  async fetchSettings() {
    try {
      const s = await getDoc(doc(db, "settings", "shop"));
      return s.exists() ? s.data() : {};
    } catch { return {}; }
  },

  // รีเซ็ตยอดขาย = ตั้งจุดเริ่มนับใหม่ ไม่ได้ลบออเดอร์ทิ้ง
  // ลูกค้ายังเห็นประวัติการซื้อของตัวเองครบเหมือนเดิม
  setSalesResetPoint(when = new Date()) {
    return setDoc(doc(db, "settings", "shop"), {
      salesResetAt: when,
      salesResetBy: currentUser.email || "",
      updatedAt: serverTimestamp(),
    }, { merge: true });
  },

  clearSalesResetPoint() {
    return setDoc(doc(db, "settings", "shop"),
      { salesResetAt: null, updatedAt: serverTimestamp() }, { merge: true });
  },
  // ลบชื่อผู้ใช้/รหัสผ่านของลูกค้าออกจากออเดอร์ (ใช้ตอนแอดมินเติมเกมเสร็จแล้ว)
  // ไอดีเกม/UID ยังเก็บไว้เป็นหลักฐานว่าเติมให้ใครไป
  clearOrderCustomerInfo: orderId => callAdmin("/admin/order/clear-info", { orderId }),

  // ตั้ง/ถอดสิทธิ์แอดมิน — เซิร์ฟเวอร์ตั้ง custom claim ในบัญชี Firebase Auth
  // แล้วเขียน role ในเอกสารให้ตรงกัน ทั้งสองอย่างเบราว์เซอร์แตะเองไม่ได้
  setRole: (uid, role) => callAdmin("/admin/role", { uid, makeAdmin: role === "admin" }),

  // ดูว่าตอนนี้เซิร์ฟเวอร์มองว่าเราเป็นแอดมินจริงไหม (ใช้ตรวจตอนสิทธิ์ไม่ตรงกัน)
  adminWhoAmI: () => callAdmin("/admin/whoami"),

  // ตั้งแอดมินคนแรก / กู้คืนสิทธิ์ ด้วยรหัสลับที่ตั้งไว้ใน Cloudflare
  async bootstrapAdmin(secret) {
    const r = await callAdmin("/admin/bootstrap", { secret });
    await QQ.refreshClaims();
    return r;
  },

  updateMyProfile: (data) => updateDoc(doc(db, "users", currentUser.uid), data),
};

window.QQ = QQ;
