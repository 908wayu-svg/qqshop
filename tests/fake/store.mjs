// ===== Firestore จำลอง (ในหน่วยความจำ) + กฎความปลอดภัยที่ถอดมาจาก firestore.rules =====
export const OWNER_EMAILS = ["908wayu@gmail.com"];

export class Timestamp {
  constructor(ms) { this.ms = ms; }
  toMillis() { return this.ms; }
  toDate() { return new Date(this.ms); }
}
export const SERVER_TS = Symbol("serverTimestamp");

export const state = {
  docs: new Map(),          // path -> plain object
  user: null,               // { uid, email }
  clock: Date.now(),
  reads: 0, writes: 0, denied: [], failReads: false,
};

export const reset = () => {
  state.docs = new Map(); state.user = null;
  state.reads = 0; state.writes = 0; state.denied = []; state.failReads = false;
};

const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v, (k, val) =>
  val instanceof Timestamp ? { __ts: val.ms } : val), (k, val) =>
  val && typeof val === "object" && "__ts" in val ? new Timestamp(val.__ts) : val);

export const put = (path, data) => state.docs.set(path, clone(data));
export const raw = path => state.docs.get(path);

const parts = p => p.split("/");
const colOf = p => parts(p)[0];

// ---------- กฎ (ถอดจาก firestore.rules ทีละบรรทัด) ----------
const signedIn = () => !!state.user;
const isAdmin = () => {
  if (!signedIn()) return false;
  if (OWNER_EMAILS.includes((state.user.email || "").toLowerCase())) return true;
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

export function can(op, path, after, before) {
  const seg = parts(path), col = seg[0];

  if (col === "users" && seg.length === 2) {
    const uid = seg[1];
    if (op === "read") return isAdmin() || isOwner(uid);
    if (op === "create") return isOwner(uid) && after.role === "member" && after.credit === 0;
    if (op === "update") {
      if (isAdmin()) return true;
      if (!isOwner(uid)) return false;
      return affected(before, after).every(k => ["name", "phone"].includes(k));
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
    if (op === "create") return false;               // ต้องผ่าน Worker เท่านั้น
    if (op === "read") return isAdmin() || (signedIn() && before?.uid === state.user.uid);
    return isAdmin();
  }

  if (col === "topups" && seg.length === 2) {
    if (op === "create") {
      if (isAdmin()) return true;
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
    return isAdmin();
  }

  if (col === "topupSlips" && seg.length === 2) {
    if (op === "create") return signedIn() && after.uid === state.user.uid && isImg(after.slip);
    if (op === "read") return isAdmin() || (signedIn() && before?.uid === state.user.uid);
    if (op === "update") return false;
    if (op === "delete") return isAdmin();
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
