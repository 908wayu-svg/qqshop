// ===== ระบบสมาชิก (Firebase Authentication + Firestore) =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, updateProfile,
  GoogleAuthProvider, FacebookAuthProvider, signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, collection,
  serverTimestamp, query, orderBy, getDocs, limit,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./firebase-config.js";

let app, auth, db;
if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

// โปรไฟล์ผู้ใช้ปัจจุบัน (null = ยังไม่ล็อกอิน)
let currentUser = null;
let currentProfile = null;
const readyWaiters = [];
let authReady = false;

// บันทึก/อัปเดตข้อมูลสมาชิกใน Firestore
async function upsertUserDoc(user, extra = {}) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const provider = user.providerData[0]?.providerId || "password";
    const data = {
      uid: user.uid,
      email: user.email || "",
      name: extra.name || user.displayName || (user.email || "").split("@")[0],
      phone: extra.phone || user.phoneNumber || "",
      provider: provider === "password" ? "email" : provider.replace(".com", ""),
      role: "member",
      createdAt: serverTimestamp(),
    };
    await setDoc(ref, data);
    return data;
  }
  return snap.data();
}

async function loadProfile(user) {
  if (!user) return null;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    return snap.exists() ? snap.data() : await upsertUserDoc(user);
  } catch (e) {
    console.warn("โหลดโปรไฟล์ไม่สำเร็จ", e);
    return null;
  }
}

if (isConfigured) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    currentProfile = user ? await loadProfile(user) : null;
    authReady = true;
    readyWaiters.splice(0).forEach(fn => fn());
    document.dispatchEvent(new CustomEvent("authchange", {
      detail: { user: currentUser, profile: currentProfile },
    }));
  });
}

// รอจนรู้สถานะล็อกอินแน่นอน
function whenAuthReady() {
  if (!isConfigured) return Promise.resolve();
  if (authReady) return Promise.resolve();
  return new Promise(resolve => readyWaiters.push(resolve));
}

// แปลง error code ของ Firebase เป็นข้อความอ่านง่าย
function friendlyError(err) {
  const th = getLang() === "th";
  const map = {
    "auth/invalid-email": [th ? "รูปแบบอีเมลไม่ถูกต้อง" : "Invalid email address"],
    "auth/email-already-in-use": [th ? "อีเมลนี้ถูกใช้สมัครแล้ว" : "This email is already registered"],
    "auth/weak-password": [th ? "รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัว)" : "Password is too weak (min 6 characters)"],
    "auth/invalid-credential": [th ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : "Wrong email or password"],
    "auth/wrong-password": [th ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : "Wrong email or password"],
    "auth/user-not-found": [th ? "ไม่พบบัญชีนี้" : "No account found"],
    "auth/too-many-requests": [th ? "ลองมากเกินไป กรุณารอสักครู่" : "Too many attempts, please wait"],
    "auth/popup-closed-by-user": [th ? "ปิดหน้าต่างก่อนเข้าสู่ระบบสำเร็จ" : "Sign-in window was closed"],
    "auth/operation-not-allowed": [th ? "ยังไม่ได้เปิดใช้ช่องทางนี้ใน Firebase Console" : "This sign-in method is not enabled in Firebase Console"],
  };
  return (map[err?.code] || [err?.message || String(err)])[0];
}

export const QQAuth = {
  isConfigured,
  get user() { return currentUser; },
  get profile() { return currentProfile; },
  get isAdmin() { return currentProfile?.role === "admin"; },
  whenAuthReady,
  friendlyError,

  async registerWithEmail(email, password, name, phone) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (name) await updateProfile(cred.user, { displayName: name });
    currentProfile = await upsertUserDoc(cred.user, { name, phone });
    return cred.user;
  },

  async loginWithEmail(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  },

  async loginWithGoogle() {
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    currentProfile = await upsertUserDoc(cred.user);
    return cred.user;
  },

  async loginWithFacebook() {
    const cred = await signInWithPopup(auth, new FacebookAuthProvider());
    currentProfile = await upsertUserDoc(cred.user);
    return cred.user;
  },

  async resetPassword(email) {
    await sendPasswordResetEmail(auth, email);
  },

  async logout() {
    await signOut(auth);
  },

  // บันทึกออเดอร์ลง Firestore (ใช้ตอน checkout)
  async saveOrder(order) {
    if (!isConfigured) return null;
    const ref = await addDoc(collection(db, "orders"), {
      ...order,
      uid: currentUser?.uid || null,
      customerName: currentProfile?.name || order.customerName || "Guest",
      customerEmail: currentUser?.email || order.customerEmail || "",
      status: "pending",
      createdAt: serverTimestamp(),
    });
    return ref.id;
  },

  // สำหรับหน้าหลังบ้าน
  async fetchOrders(max = 500) {
    const q = query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async fetchUsers(max = 500) {
    const q = query(collection(db, "users"), orderBy("createdAt", "desc"), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
};

// เปิดให้สคริปต์ธรรมดา (app.js) เรียกใช้ได้
window.QQAuth = QQAuth;
document.dispatchEvent(new Event("qqauth-loaded"));
