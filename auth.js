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
  serverTimestamp, query, orderBy, where, getDocs, limit, onSnapshot, runTransaction, writeBatch, deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./firebase-config.js";
import { SHOP } from "./shop-config.js";

// เส้นทางสั่งซื้อฝั่งเซิร์ฟเวอร์ (Cloudflare Worker ตัวเดียวกับบอทรับซอง)
const ORDER_API = (SHOP.channels.angpao?.botUrl || "").replace(/\/$/, "") + "/order";

// อีเมลเจ้าของร้าน — เข้าหลังบ้านได้เสมอ
// *** ถ้าแก้ตรงนี้ ต้องแก้ ownerEmails() ในไฟล์ firestore.rules ให้ตรงกันด้วย ***
const ADMIN_EMAILS = ["908wayu@gmail.com"];

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
    } else {
      currentProfile = null;
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
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่ได้"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("ไฟล์นี้ไม่ใช่รูปภาพ"));
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

export const QQ = {
  isConfigured,
  get user() { return currentUser; },
  get profile() { return currentProfile; },
  get credit() { return Number(currentProfile?.credit || 0); },
  get isAdmin() {
    return currentProfile?.role === "admin"
      || ADMIN_EMAILS.includes((currentUser?.email || "").toLowerCase());
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
      ? updateDoc(doc(col, itemId), { ...data, updatedAt: serverTimestamp() })
      : addDoc(col, { ...data, status: "available", createdAt: serverTimestamp() });
  },

  deleteStockItem: (productId, itemId) =>
    deleteDoc(doc(db, "products", productId, "stockItems", itemId)),

  // บันทึกหลายชิ้นพร้อมกัน (Firestore รับได้ 500 การเขียนต่อ 1 batch)
  async saveStockItemsBulk(productId, changes) {
    const col = collection(db, "products", productId, "stockItems");
    for (let i = 0; i < changes.length; i += 400) {
      const batch = writeBatch(db);
      changes.slice(i, i + 400).forEach(c =>
        batch.update(doc(col, c.id), { ...c.data, updatedAt: serverTimestamp() }));
      await batch.commit();
    }
  },

  // จำนวนคงเหลือของสินค้าดิจิทัล = จำนวนชิ้นที่ยังไม่ถูกขาย
  // เขียนกลับลงฟิลด์ stock เพื่อให้หน้าร้านและเซิร์ฟเวอร์ใช้ตัวเลขเดียวกัน
  async syncDigitalStock(productId) {
    const items = await QQ.fetchStockItems(productId);
    const available = items.filter(i => i.status !== "sold").length;
    await updateDoc(doc(db, "products", productId), { stock: available });
    return available;
  },

  // ---------- ออเดอร์ ----------
  // สั่งซื้อผ่านเซิร์ฟเวอร์ ส่งไปแค่รหัสสินค้ากับจำนวน
  // ราคา/ยอดรวม/สต๊อก/เครดิต ตรวจและคิดที่ฝั่งเซิร์ฟเวอร์ทั้งหมด ลูกค้าแก้ไม่ได้
  async createOrder(items) {
    const res = await fetch(ORDER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken: await auth.currentUser.getIdToken(),
        items: items.map(i => ({ id: i.id, qty: i.qty })),
      }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: "BOT_UNREACHABLE" }));
    if (!data.ok) throw Object.assign(new Error(data.error), { orderCode: data.error });
    return data;
  },
  async fetchOrders(max = 500) {
    return rows(await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(max))));
  },
  // ต้องกรองด้วย where ให้ Firestore ตั้งแต่ต้น ไม่งั้นกฎความปลอดภัยจะปฏิเสธทั้งคำสั่ง
  async fetchMyOrders(max = 50) {
    return sortByCreatedDesc(rows(await myQuery("orders", max)));
  },

  // อนุมัติออเดอร์ = หักเครดิต + ตัดสต๊อก + ส่งมอบไอดี/รหัสผ่าน + เปลี่ยนสถานะ
  // ทำพร้อมกันทั้งหมดแบบ transaction ถ้าพลาดขั้นใดจะไม่เกิดอะไรขึ้นเลย
  async approveOrder(orderId) {
    const oRef = doc(db, "orders", orderId);
    const pre = await getDoc(oRef);
    if (!pre.exists()) throw new Error("ไม่พบออเดอร์");
    if (pre.data().status !== "pending") throw new Error("ออเดอร์นี้ถูกดำเนินการไปแล้ว");

    const items = pre.data().items || [];

    // เลือกชิ้นที่จะส่งมอบไว้ก่อน เพราะ transaction ฝั่งเบราว์เซอร์ "ค้นหา" เอกสารไม่ได้
    // รวมจำนวนของสินค้ารหัสเดียวกันก่อน ไม่งั้นจองซ้ำแล้วได้ของไม่ครบ
    const wanted = new Map();
    items.forEach(i => wanted.set(String(i.id), (wanted.get(String(i.id)) || 0) + Number(i.qty || 0)));

    const claims = {};
    for (const [pid, qty] of wanted) {
      const pSnap = await getDoc(doc(db, "products", pid));
      if (!pSnap.exists() || !pSnap.data().digital) continue;

      const avail = await getDocs(query(
        collection(db, "products", pid, "stockItems"),
        where("status", "==", "available"), limit(qty)));
      if (avail.size < qty) {
        const nm = items.find(i => String(i.id) === pid)?.name || pid;
        throw new Error(`${t("not_enough_stock_items")}: ${nm}`);
      }
      claims[pid] = avail.docs.map(d => d.ref);
    }

    return runTransaction(db, async (tx) => {
      // ---- อ่านให้ครบก่อน (Firestore บังคับ) ----
      const oSnap = await tx.get(oRef);
      if (!oSnap.exists()) throw new Error("ไม่พบออเดอร์");
      const o = oSnap.data();
      if (o.status !== "pending") throw new Error("ออเดอร์นี้ถูกดำเนินการไปแล้ว");

      const uRef = doc(db, "users", o.uid);
      const uSnap = await tx.get(uRef);
      const credit = Number(uSnap.data()?.credit || 0);
      if (credit < o.total) throw new Error(t("insufficient_customer_credit"));

      const pSnaps = await Promise.all(items.map(i => tx.get(doc(db, "products", String(i.id)))));

      const claimSnaps = {};
      for (const [pid, refs] of Object.entries(claims)) {
        claimSnaps[pid] = await Promise.all(refs.map(r => tx.get(r)));
      }

      // ---- ตรวจแล้วค่อยเขียน ----
      // ตัดสต๊อกทีเดียวต่อสินค้า 1 ชิ้น (รหัสเดียวกันหลายแถวต้องรวมกันก่อน)
      const stockWrites = [];
      const stockLeft = new Map();
      items.forEach((i, idx) => {
        const pid = String(i.id);
        const snap = pSnaps[idx];
        if (!snap.exists()) return;
        const stock = snap.data().stock;
        if (stock === null || stock === undefined) return;
        const left = (stockLeft.has(pid) ? stockLeft.get(pid) : Number(stock)) - Number(i.qty);
        if (left < 0) throw new Error(`${t("out_of_stock")}: ${i.name}`);
        stockLeft.set(pid, left);
        stockWrites.push([snap.ref, left]);
      });

      const queue = Object.fromEntries(
        Object.entries(claimSnaps).map(([pid, arr]) => [pid, [...arr]]));

      const newItems = items.map((i) => {
        const pid = String(i.id);
        // สินค้าดิจิทัล: คัดลอกไอดี/รหัสผ่านเข้าไปในออเดอร์ แล้วตัดชิ้นนั้นออกจากคลัง
        if (!queue[pid]) return i;
        const picked = queue[pid].splice(0, Number(i.qty));
        if (picked.length < Number(i.qty)) throw new Error(t("stock_item_taken"));
        const delivered = picked.map(s => {
          if (!s.exists() || s.data().status !== "available") {
            throw new Error(t("stock_item_taken"));   // มีคนคว้าไปก่อน ให้กดใหม่
          }
          return {
            login: s.data().login || "",
            password: s.data().password || "",
            note: s.data().note || "",
          };
        });
        return { ...i, delivered };
      });

      stockWrites.forEach(([ref, left]) => tx.update(ref, { stock: left }));
      Object.entries(claims).forEach(([, refs]) => refs.forEach(r =>
        tx.update(r, { status: "sold", orderId, uid: o.uid, soldAt: serverTimestamp() })));

      tx.update(uRef, { credit: money2(credit - o.total) });
      tx.update(oRef, {
        items: newItems,
        status: "approved",
        approvedAt: serverTimestamp(),
        approvedBy: currentUser.email || "",
      });
    });
  },
  // ต้องเช็คสถานะก่อนเสมอ — ถ้าเผลอกด "ไม่อนุมัติ" ทับออเดอร์ที่อนุมัติไปแล้ว
  // เครดิตที่หักไปกับของที่ส่งมอบไปแล้วจะไม่ถูกคืน แต่ประวัติกลับขึ้นว่าไม่อนุมัติ
  rejectOrder(orderId, note = "") {
    return runTransaction(db, async (tx) => {
      const ref = doc(db, "orders", orderId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error(t("not_found"));
      if (snap.data().status !== "pending") throw new Error(t("already_handled"));
      tx.update(ref, {
        status: "rejected", note,
        approvedAt: serverTimestamp(), approvedBy: currentUser.email || "",
      });
    });
  },

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

  // อนุมัติเติมเงิน = เพิ่มเครดิตให้ลูกค้า + เปลี่ยนสถานะ
  // amountOverride ใช้กับรายการที่บอทบันทึกยอดไม่ทัน (amount = 0)
  // ถ้าไม่บังคับให้ใส่ยอด แอดมินจะกดอนุมัติแล้วเครดิตเข้า 0 บาทแบบเงียบๆ
  async approveTopup(topupId, amountOverride = null) {
    return runTransaction(db, async (tx) => {
      const tRef = doc(db, "topups", topupId);
      const tSnap = await tx.get(tRef);
      if (!tSnap.exists()) throw new Error(t("not_found"));
      const data = tSnap.data();
      if (!OPEN_STATES.includes(data.status)) throw new Error(t("already_handled"));

      const amount = money2(amountOverride ?? data.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error(t("amount_missing"));

      const uRef = doc(db, "users", data.uid);
      const uSnap = await tx.get(uRef);
      if (!uSnap.exists()) throw new Error(t("member_not_found"));
      const credit = Number(uSnap.data().credit || 0);

      tx.update(uRef, { credit: money2(credit + amount) });
      tx.update(tRef, {
        amount,
        status: "approved",
        approvedAt: serverTimestamp(),
        approvedBy: currentUser.email || "",
      });
    });
  },

  // เช็คสถานะก่อนเช่นกัน กัน "ไม่อนุมัติ" ทับรายการที่เติมเครดิตไปแล้ว
  rejectTopup(id, note = "") {
    return runTransaction(db, async (tx) => {
      const ref = doc(db, "topups", id);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error(t("not_found"));
      if (!OPEN_STATES.includes(snap.data().status)) throw new Error(t("already_handled"));
      tx.update(ref, {
        status: "rejected", note,
        approvedAt: serverTimestamp(), approvedBy: currentUser.email || "",
      });
    });
  },

  // ---------- สมาชิก (แอดมิน) ----------
  // ห้ามใส่ orderBy("createdAt") ที่นี่ — สมาชิกที่สมัครไว้ก่อนจะมีฟิลด์นี้
  // จะถูก Firestore ตัดทิ้งเงียบๆ ทั้งจากรายชื่อ ยอดสมาชิก และเครดิตคงเหลือรวม
  // (กฎเหล็กข้อ 5) จำนวนสมาชิกไม่เยอะ เรียงเองใน JS ปลอดภัยกว่า
  async fetchUsers(max = 500) {
    return sortByCreatedDesc(rows(await getDocs(query(collection(db, "users"), limit(max)))));
  },
  // แอดมินปรับเครดิตให้ใครก็ได้ ใส่ค่าติดลบ = หักคืน (บันทึกไว้ในประวัติด้วย)
  // ใช้ transaction ไม่ใช่ batch — ต้องอ่านเครดิตปัจจุบันมาเช็คว่าหักแล้วไม่ติดลบ
  // ถ้าอ่านนอก transaction แล้วสองหน้าจอกดหักพร้อมกัน เครดิตจะติดลบได้
  async adjustCredit(uid, amount, note = "") {
    const amt = money2(amount);
    if (!Number.isFinite(amt) || amt === 0) throw new Error(t("amount_invalid"));
    const logRef = doc(collection(db, "topups"));

    return runTransaction(db, async (tx) => {
      const uRef = doc(db, "users", uid);
      const u = await tx.get(uRef);
      if (!u.exists()) throw new Error(t("member_not_found"));
      const before = Number(u.data().credit || 0);
      if (before + amt < 0) throw new Error(t("would_go_negative"));

      tx.update(uRef, { credit: money2(before + amt) });
      tx.set(logRef, {
        uid, name: u.data().name || "", email: u.data().email || "",
        amount: amt, method: "admin", note,
        status: "approved", createdAt: serverTimestamp(),
        approvedAt: serverTimestamp(), approvedBy: currentUser.email || "",
      });
    });
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
  setRole: (uid, role) => updateDoc(doc(db, "users", uid), { role }),
  updateMyProfile: (data) => updateDoc(doc(db, "users", currentUser.uid), data),
};

window.QQ = QQ;
