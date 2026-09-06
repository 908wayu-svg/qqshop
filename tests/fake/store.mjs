// ===== Firestore จำลอง (ในหน่วยความจำ) + กฎความปลอดภัยที่ถอดมาจาก firestore.rules =====
// *** แก้ firestore.rules เมื่อไหร่ ต้องแก้ไฟล์นี้ให้ตรงกันเสมอ ***

export class Timestamp {
  constructor(ms) { this.ms = ms; }
  toMillis() { return this.ms; }
  toDate() { return new Date(this.ms); }
}
export const SERVER_TS = Symbol("serverTimestamp");

export const state = {
  docs: new Map(),          // path -> plain object
  user: null,               // { uid, email }
  claims: new Map(),        // uid -> custom claims (เช่น { admin: true })
  clock: Date.now(),
  reads: 0, writes: 0, denied: [], failReads: false,
  // จำลอง "ยังไม่มี composite index" — Firestore จะปฏิเสธคำสั่งที่มีทั้ง where และ orderBy
  // เกิดจริงตอน deploy index ใหม่ๆ (ยังสร้างไม่เสร็จ) หรือมีคนเผลอลบ index ทิ้ง
  failOrderedQueries: false,
};

export const reset = () => {
  state.docs = new Map(); state.user = null; state.claims = new Map();
  state.reads = 0; state.writes = 0; state.denied = []; state.failReads = false;
  state.failOrderedQueries = false;
};

// ตั้ง custom claim ให้บัญชีหนึ่ง (แทนการเรียก /admin/role ที่เซิร์ฟเวอร์จริง)
export const setClaims = (uid, claims) => state.claims.set(uid, { ...claims });
export const claimsOf = uid => state.claims.get(uid) || {};

const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v, (k, val) =>
  val instanceof Timestamp ? { __ts: val.ms } : val), (k, val) =>
  val && typeof val === "object" && "__ts" in val ? new Timestamp(val.__ts) : val);

export const put = (path, data) => state.docs.set(path, clone(data));
export const raw = path => state.docs.get(path);

const parts = p => p.split("/");

// ---------- กฎ (ถอดจาก firestore.rules ทีละบรรทัด) ----------
const signedIn = () => !!state.user;

// แอดมินต้องผ่าน 2 ชั้น: custom claim ในโทเคน + role ในเอกสาร
// (เอกสารเขียนได้จากเซิร์ฟเวอร์เท่านั้น ถอนสิทธิ์แล้วมีผลทันทีไม่ต้องรอโทเคนหมดอายุ)
const isAdmin = () => {
  if (!signedIn()) return false;
  if (claimsOf(state.user.uid).admin !== true) return false;
  const u = state.docs.get("users/" + state.user.uid);
  return !!u && u.role === "admin";
};

const isOwner = uid => signedIn() && state.user.uid === uid;
const affected = (before, after) => {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter(k => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
};
const isImg = s => typeof s === "string"
  && /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < 1000000;

const USER_CREATE_KEYS = ["uid", "email", "name", "phone", "provider", "role", "credit", "createdAt"];

export function can(op, path, after, before) {
  const seg = parts(path), col = seg[0];

  if (col === "users" && seg.length === 2) {
    const uid = seg[1];
    if (op === "read") return isAdmin() || isOwner(uid);
    if (op === "create") {
      return isOwner(uid)
        && after.role === "member"
        && after.credit === 0
        && String(after.email ?? "") === String(state.user.email ?? "")
        && Object.keys(after).every(k => USER_CREATE_KEYS.includes(k));
    }
    if (op === "update") {
      // ห้ามทุกคนแก้ credit / role ผ่านเบราว์เซอร์ รวมถึงแอดมินเอง
      // สองอย่างนี้เปลี่ยนได้ทางเดียวคือผ่าน Worker (service account ไม่อยู่ใต้กฎ)
      if (!isOwner(uid) && !isAdmin()) return false;
      if (!affected(before, after).every(k => ["name", "phone"].includes(k))) return false;
      const name = after.name ?? "", phone = after.phone ?? "";
      return typeof name === "string" && name.length < 120
        && typeof phone === "string" && phone.length < 40;
    }
    if (op === "delete") return isAdmin();
  }

  if (col === "products") {
    if (seg.length === 2) return op === "read" ? true : isAdmin();
    if (seg[2] === "stockItems") return isAdmin();   // ลูกค้าอ่านรหัสผ่านในคลังไม่ได้เลย
  }

  if (col === "productImages") return op === "read" ? true : isAdmin();

  if (col === "settings") return isAdmin();

  if (col === "orders" && seg.length === 2) {
    // สร้าง/แก้/ลบ ต้องผ่าน Worker เท่านั้น (แม้แต่แอดมิน)
    if (op === "read") return isAdmin() || (signedIn() && before?.uid === state.user.uid);
    return false;
  }

  if (col === "topups" && seg.length === 2) {
    if (op === "create") {
      if (!signedIn()) return false;
      const d = after;
      const slipOk = !("slip" in d) || isImg(d.slip);
      const angpaoOk = !("angpaoLink" in d)
        || (typeof d.angpaoLink === "string"
            && /^https:\/\/[a-z0-9.-]*truemoney\.com\/.*/.test(d.angpaoLink)
            && d.angpaoLink.length < 500);
      const hasProof = d.method === "angpao" ? ("angpaoLink" in d) : (d.hasSlip === true || "slip" in d);
      return d.uid === state.user.uid && d.status === "pending"
        && typeof d.amount === "number" && d.amount > 0 && d.amount <= 100000
        && ["truewallet", "bank", "promptpay", "angpao"].includes(d.method)
        && hasProof && slipOk && angpaoOk;
    }
    if (op === "read") return isAdmin() || (signedIn() && before?.uid === state.user.uid);
    // อนุมัติ/ไม่อนุมัติ ทำที่ Worker เท่านั้น เพราะขยับเครดิตจริง
    return false;
  }

  if (col === "topupSlips" && seg.length === 2) {
    if (op === "create") return signedIn() && after.uid === state.user.uid && isImg(after.slip);
    if (op === "read") return isAdmin() || (signedIn() && before?.uid === state.user.uid);
    if (op === "update") return false;
    if (op === "delete") return isAdmin();
  }

  // บันทึกการกระทำของแอดมิน — อ่านได้เฉพาะแอดมิน เขียนได้เฉพาะเซิร์ฟเวอร์
  if (col === "adminLogs" && seg.length === 2) {
    return op === "read" ? isAdmin() : false;
  }

  return false;   // ไม่มีกฎ = ปฏิเสธ
}

export class PermissionError extends Error {
  constructor(path, op) {
    super("Missing or insufficient permissions. (" + op + " " + path + ")");
    this.code = "permission-denied";
    state.denied.push(op + " " + path);
  }
}

export const resolveTs = obj => {
  if (obj === SERVER_TS) return new Timestamp(state.clock++);
  if (Array.isArray(obj)) return obj.map(resolveTs);
  if (obj && typeof obj === "object" && !(obj instanceof Timestamp) && !(obj instanceof Date)) {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolveTs(v)]));
  }
  if (obj instanceof Date) return new Timestamp(obj.getTime());
  return obj;
};
export { clone };
