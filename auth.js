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
  serverTimestamp, query, orderBy, getDocs, limit, onSnapshot, runTransaction, increment, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./firebase-config.js";

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
  if (snap.exists()) return snap.data();

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
function resizeImage(file, maxSide = 900, quality = 0.75) {
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
        for (let q = quality; out.length > 700000 && q > 0.3; q -= 0.15) {
          out = c.toDataURL("image/jpeg", q);
        }
        out.length > 900000 ? reject(new Error(t("image_too_big"))) : resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

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
  async fetchProducts() {
    const snap = await getDocs(query(collection(db, "products"), orderBy("sort", "asc")));
    return rows(snap);
  },
  saveProduct(id, data) {
    return id
      ? updateDoc(doc(db, "products", id), { ...data, updatedAt: serverTimestamp() })
      : addDoc(collection(db, "products"), { ...data, createdAt: serverTimestamp() });
  },
  deleteProduct: id => deleteDoc(doc(db, "products", id)),

  // ---------- ออเดอร์ ----------
  createOrder(order) {
    return addDoc(collection(db, "orders"), {
      ...order,
      uid: currentUser.uid,
      customerName: currentProfile?.name || "",
      customerEmail: currentUser.email || "",
      status: "pending",
      createdAt: serverTimestamp(),
    });
  },
  async fetchOrders(max = 500) {
    return rows(await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(max))));
  },
  async fetchMyOrders(max = 50) {
    const all = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(max)));
    return rows(all).filter(o => o.uid === currentUser?.uid);
  },

  // อนุมัติออเดอร์ = หักเครดิตลูกค้า + เปลี่ยนสถานะ (ทำพร้อมกันแบบ transaction)
  async approveOrder(orderId) {
    return runTransaction(db, async (tx) => {
      const oRef = doc(db, "orders", orderId);
      const oSnap = await tx.get(oRef);
      if (!oSnap.exists()) throw new Error("ไม่พบออเดอร์");
      const o = oSnap.data();
      if (o.status !== "pending") throw new Error("ออเดอร์นี้ถูกดำเนินการไปแล้ว");

      const uRef = doc(db, "users", o.uid);
      const uSnap = await tx.get(uRef);
      const credit = Number(uSnap.data()?.credit || 0);
      if (credit < o.total) throw new Error(t("insufficient_customer_credit"));

      tx.update(uRef, { credit: credit - o.total });
      tx.update(oRef, {
        status: "approved",
        approvedAt: serverTimestamp(),
        approvedBy: currentUser.email || "",
      });
    });
  },
  rejectOrder: (orderId, note = "") => updateDoc(doc(db, "orders", orderId), {
    status: "rejected", note, approvedAt: serverTimestamp(), approvedBy: currentUser.email || "",
  }),

  // ---------- เติมเงิน ----------
  createTopup(data) {
    return addDoc(collection(db, "topups"), {
      ...data,
      uid: currentUser.uid,
      name: currentProfile?.name || "",
      email: currentUser.email || "",
      status: "pending",
      createdAt: serverTimestamp(),
    });
  },
  async fetchTopups(max = 500) {
    return rows(await getDocs(query(collection(db, "topups"), orderBy("createdAt", "desc"), limit(max))));
  },
  async fetchMyTopups(max = 50) {
    const all = await getDocs(query(collection(db, "topups"), orderBy("createdAt", "desc"), limit(max)));
    return rows(all).filter(x => x.uid === currentUser?.uid);
  },

  // อนุมัติเติมเงิน = เพิ่มเครดิตให้ลูกค้า + เปลี่ยนสถานะ
  async approveTopup(topupId) {
    return runTransaction(db, async (tx) => {
      const tRef = doc(db, "topups", topupId);
      const tSnap = await tx.get(tRef);
      if (!tSnap.exists()) throw new Error("ไม่พบรายการ");
      const data = tSnap.data();
      if (data.status !== "pending") throw new Error("รายการนี้ถูกดำเนินการไปแล้ว");

      const uRef = doc(db, "users", data.uid);
      const uSnap = await tx.get(uRef);
      const credit = Number(uSnap.data()?.credit || 0);

      tx.update(uRef, { credit: credit + Number(data.amount) });
      tx.update(tRef, {
        status: "approved",
        approvedAt: serverTimestamp(),
        approvedBy: currentUser.email || "",
      });
    });
  },
  rejectTopup: (id, note = "") => updateDoc(doc(db, "topups", id), {
    status: "rejected", note, approvedAt: serverTimestamp(), approvedBy: currentUser.email || "",
  }),

  // ---------- สมาชิก (แอดมิน) ----------
  async fetchUsers(max = 500) {
    return rows(await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(max))));
  },
  // แอดมินเพิ่มเครดิตให้ใครก็ได้ (บันทึกไว้ในประวัติเติมเงินด้วย)
  // เขียนสองที่พร้อมกันแบบ batch — สำเร็จทั้งคู่หรือไม่สำเร็จเลย จะได้ไม่มีเครดิตเข้าแบบไม่มีประวัติ
  async addCreditTo(uid, amount, note = "") {
    const amt = Number(amount);
    const u = await getDoc(doc(db, "users", uid));
    const batch = writeBatch(db);

    batch.update(doc(db, "users", uid), { credit: increment(amt) });
    batch.set(doc(collection(db, "topups")), {
      uid, name: u.data()?.name || "", email: u.data()?.email || "",
      amount: amt, method: "admin", note,
      status: "approved", createdAt: serverTimestamp(),
      approvedAt: serverTimestamp(), approvedBy: currentUser.email || "",
    });

    await batch.commit();
  },
  setRole: (uid, role) => updateDoc(doc(db, "users", uid), { role }),
  updateMyProfile: (data) => updateDoc(doc(db, "users", currentUser.uid), data),
};

window.QQ = QQ;
