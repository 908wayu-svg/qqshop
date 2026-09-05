// ===== ตัวแทน firebase-auth.js สำหรับการทดสอบ =====
import { state } from "./store.mjs";

const accounts = new Map();   // email -> { uid, password, displayName }
let seq = 0;
const cbs = new Set();
export const authObj = { currentUser: null };

const fire = () => cbs.forEach(cb => cb(authObj.currentUser));
const mkUser = (email, extra = {}) => ({
  uid: extra.uid || "u" + (++seq),
  email,
  displayName: extra.displayName || null,
  phoneNumber: null,
  providerData: [{ providerId: extra.providerId || "password" }],
  getIdToken: async () => "token:" + (extra.uid || email),
});

export const getAuth = () => authObj;
export function onAuthStateChanged(auth, cb) { cbs.add(cb); cb(authObj.currentUser); return () => cbs.delete(cb); }

const setUser = u => {
  authObj.currentUser = u;
  state.user = u ? { uid: u.uid, email: u.email } : null;
  fire();
};

export async function createUserWithEmailAndPassword(auth, email, password) {
  if (accounts.has(email)) { const e = new Error("exists"); e.code = "auth/email-already-in-use"; throw e; }
  if ((password || "").length < 6) { const e = new Error("weak"); e.code = "auth/weak-password"; throw e; }
  const u = mkUser(email);
  accounts.set(email, { ...u, password });
  setUser(u);
  await new Promise(r => setTimeout(r, 0));   // ให้ onAuthStateChanged ทำงานให้จบก่อน
  return { user: u };
}
export async function signInWithEmailAndPassword(auth, email, password) {
  const a = accounts.get(email);
  if (!a || a.password !== password) { const e = new Error("bad"); e.code = "auth/invalid-credential"; throw e; }
  const u = mkUser(email, { uid: a.uid, displayName: a.displayName });
  setUser(u);
  await new Promise(r => setTimeout(r, 0));
  return { user: u };
}
export async function signInWithPopup(auth, provider) {
  const email = provider.__email || "google-user@example.com";
  let a = accounts.get(email);
  if (!a) { const u = mkUser(email, { providerId: "google.com" }); accounts.set(email, { ...u, password: null }); a = accounts.get(email); }
  const u = mkUser(email, { uid: a.uid, providerId: "google.com" });
  setUser(u);
  await new Promise(r => setTimeout(r, 0));
  return { user: u };
}
export async function signOut() { setUser(null); await new Promise(r => setTimeout(r, 0)); }
export async function sendPasswordResetEmail(auth, email) {
  if (!accounts.has(email)) { const e = new Error("nf"); e.code = "auth/user-not-found"; throw e; }
}
export async function updateProfile(user, { displayName }) {
  user.displayName = displayName;
  const a = accounts.get(user.email); if (a) a.displayName = displayName;
}
export function GoogleAuthProvider() { this.__email = GoogleAuthProvider.nextEmail || "google-user@example.com"; }
export function FacebookAuthProvider() { this.__email = "fb-user@example.com"; }

export const testAccounts = accounts;
export const resetAuth = () => { accounts.clear(); cbs.clear(); seq = 0; authObj.currentUser = null; state.user = null; };
