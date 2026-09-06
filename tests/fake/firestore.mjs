// ===== ตัวแทน firebase-firestore.js สำหรับการทดสอบ =====
import { state, can, PermissionError, resolveTs, clone, Timestamp, SERVER_TS } from "./store.mjs";

export { Timestamp };
export const getFirestore = () => ({ __db: true });
export const serverTimestamp = () => SERVER_TS;
export const increment = n => ({ __inc: n });
export const DELETE = Symbol("deleteField");
export const deleteField = () => DELETE;

const join = segs => segs.join("/");

export function collection(dbOrRef, ...segs) {
  const base = dbOrRef?.__path ? dbOrRef.__path : "";
  return { __col: true, __path: join([base, ...segs].filter(Boolean)) };
}
export function doc(dbOrRef, ...segs) {
  if (dbOrRef?.__col) {
    const id = segs[0] ?? "auto_" + Math.random().toString(36).slice(2, 12);
    return { __doc: true, __path: dbOrRef.__path + "/" + id, id };
  }
  const path = join(segs);
  return { __doc: true, __path: path, id: segs[segs.length - 1] };
}

export const where = (f, op, v) => ({ k: "where", f, op, v });
export const orderBy = (f, dir = "asc") => ({ k: "order", f, dir });
export const limit = n => ({ k: "limit", n });
export const query = (col, ...cl) => ({ __q: true, col, clauses: cl });

const snapOf = (ref, data) => ({
  id: ref.id, ref,
  exists: () => data !== undefined,
  data: () => data === undefined ? undefined : clone(data),
});

// สวิตช์จำลอง "อ่านฐานข้อมูลไม่ได้" (เน็ตหลุด / Firestore ล่ม)
function maybeFail() {
  if (!state.failReads) return;
  const e = new Error("เชื่อมต่อฐานข้อมูลไม่ได้"); e.code = "unavailable"; throw e;
}

function readDoc(ref) {
  maybeFail();
  state.reads++;
  const data = state.docs.get(ref.__path);
  if (!can("read", ref.__path, null, data)) throw new PermissionError(ref.__path, "read");
  return snapOf(ref, data);
}
export const getDoc = async ref => readDoc(ref);

const val = (o, f) => f.split(".").reduce((a, k) => a?.[k], o);
const cmp = (a, b) => {
  const av = a instanceof Timestamp ? a.toMillis() : a;
  const bv = b instanceof Timestamp ? b.toMillis() : b;
  return av < bv ? -1 : av > bv ? 1 : 0;
};

export async function getDocs(q) {
  maybeFail();
  const col = q.__q ? q.col.__path : q.__path;
  const clauses = q.__q ? q.clauses : [];
  const wheres = clauses.filter(c => c.k === "where");
  const orders = clauses.filter(c => c.k === "order");
  const lim = clauses.find(c => c.k === "limit")?.n;

  // เลียนแบบ Firestore: กฎถูกตรวจกับ "คำสั่ง" ไม่ใช่ผลลัพธ์
  // ถ้าคำสั่งอาจดึงเอกสารที่ไม่มีสิทธิ์อ่าน จะถูกปฏิเสธทั้งคำสั่ง
  const anyDoc = can("read", col + "/__probe__", null, { uid: "__other__" });
  if (!anyDoc) {
    const ownDoc = can("read", col + "/__probe__", null, { uid: state.user?.uid });
    // อ่านของตัวเองก็ยังไม่ได้ = คอลเลกชันนี้ห้ามลูกค้าแตะเลย
    if (!ownDoc) throw new PermissionError(col, "list");
    const own = wheres.find(w => w.f === "uid" && w.op === "==" && w.v === state.user?.uid);
    if (!own) throw new PermissionError(col, "list");
  }

  // จำลอง "ยังไม่มี composite index" — คำสั่งที่มีทั้ง where และ orderBy จะถูกปฏิเสธ
  // (เกิดจริงตอน index เพิ่ง deploy ยังสร้างไม่เสร็จ) โค้ดต้องถอย orderBy ออกแล้วเรียงเอง
  if (state.failOrderedQueries && wheres.length && orders.length) {
    const e = new Error("The query requires an index.");
    e.code = "failed-precondition";
    throw e;
  }

  let rows = [...state.docs.entries()]
    .filter(([p]) => p.startsWith(col + "/") && p.slice(col.length + 1).indexOf("/") === -1)
    .map(([p, d]) => ({ path: p, id: p.split("/").pop(), d }));

  for (const w of wheres) {
    rows = rows.filter(r => {
      const v = val(r.d, w.f);
      if (w.op === "==") return v === w.v;
      if (w.op === "!=") return v !== w.v;
      if (w.op === ">=") return cmp(v, w.v) >= 0;
      if (w.op === "<=") return cmp(v, w.v) <= 0;
      throw new Error("op ไม่รองรับ: " + w.op);
    });
  }
  for (const o of [...orders].reverse()) {
    // Firestore ตัดเอกสารที่ไม่มีฟิลด์ที่ใช้ orderBy ทิ้ง — จำลองพฤติกรรมนี้ด้วย
    rows = rows.filter(r => val(r.d, o.f) !== undefined && val(r.d, o.f) !== null);
    rows.sort((a, b) => (o.dir === "desc" ? -1 : 1) * cmp(val(a.d, o.f), val(b.d, o.f)));
  }
  if (lim != null) rows = rows.slice(0, lim);

  state.reads += rows.length;
  const docs = rows.map(r => snapOf({ __doc: true, __path: r.path, id: r.id }, r.d));
  return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) };
}

// Firestore ตัวจริงปฏิเสธค่า undefined (ต่างจาก null ที่เก็บได้)
// ถ้าตัวจำลองรับไว้เฉยๆ โค้ดที่เผลอส่ง undefined จะผ่านเทสแต่พังตอนใช้งานจริง
function assertNoUndefined(data, path = "") {
  if (data === undefined) throw Object.assign(
    new Error("Unsupported field value: undefined (" + (path || "ทั้งเอกสาร") + ")"),
    { code: "invalid-argument" });
  if (data === null || typeof data !== "object") return;
  if (data instanceof Timestamp || data instanceof Date || typeof data === "symbol") return;
  if (Array.isArray(data)) return data.forEach((v, i) => assertNoUndefined(v, path + "[" + i + "]"));
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "symbol") continue;          // serverTimestamp() / deleteField()
    assertNoUndefined(v, path ? path + "." + k : k);
  }
}

function write(op, ref, data, { merge = false } = {}) {
  if (op !== "delete") assertNoUndefined(data);
  const before = state.docs.get(ref.__path);
  let after;
  if (op === "delete") after = undefined;
  else if (op === "update") {
    if (before === undefined) { const e = new Error("No document to update: " + ref.__path); e.code = "not-found"; throw e; }
    after = { ...before, ...resolveTs(data) };
    for (const [k, v] of Object.entries(data)) if (v === DELETE) delete after[k];
  } else {
    after = merge ? { ...(before || {}), ...resolveTs(data) } : resolveTs(data);
    for (const [k, v] of Object.entries(data)) if (v === DELETE) delete after[k];
  }

  const rule = op === "set" ? (before === undefined ? "create" : "update") : op;
  if (!can(rule, ref.__path, after, before)) throw new PermissionError(ref.__path, rule);

  state.writes++;
  if (after === undefined) state.docs.delete(ref.__path); else state.docs.set(ref.__path, clone(after));
}

export const setDoc = async (ref, data, opts) => write("set", ref, data, opts || {});
export const updateDoc = async (ref, data) => write("update", ref, data);
export const deleteDoc = async ref => write("delete", ref);
export async function addDoc(col, data) {
  const ref = doc(col);
  write("set", ref, data);
  return ref;
}

// ---------- transaction ----------
export async function runTransaction(db, fn) {
  const snapshot = new Map(state.docs);          // ถ้าล้มกลางทางต้องไม่เหลือร่องรอย
  const ops = [];
  const tx = {
    get: async ref => readDoc(ref),
    set: (ref, data, opts) => ops.push(["set", ref, data, opts || {}]),
    update: (ref, data) => ops.push(["update", ref, data]),
    delete: ref => ops.push(["delete", ref]),
  };
  try {
    const out = await fn(tx);
    for (const [op, ref, data, opts] of ops) write(op, ref, data, opts);
    return out;
  } catch (e) {
    state.docs = snapshot;
    throw e;
  }
}

export function writeBatch() {
  const ops = [];
  return {
    set: (ref, d, o) => ops.push(["set", ref, d, o || {}]),
    update: (ref, d) => ops.push(["update", ref, d]),
    delete: ref => ops.push(["delete", ref]),
    commit: async () => {
      const snapshot = new Map(state.docs);
      try { for (const [op, ref, d, o] of ops) write(op, ref, d, o); }
      catch (e) { state.docs = snapshot; throw e; }
    },
  };
}

// ---------- onSnapshot ----------
const listeners = new Set();
export function onSnapshot(ref, cb, errCb) {
  const fire = () => {
    try { cb(readDoc(ref)); } catch (e) { errCb?.(e); }
  };
  const l = { ref, fire };
  listeners.add(l);
  fire();
  return () => listeners.delete(l);
}
export const notifyAll = () => [...listeners].forEach(l => l.fire());
