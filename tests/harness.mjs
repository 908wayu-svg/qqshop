// ===== เตรียมสภาพแวดล้อมให้โค้ดจริงของเว็บทำงานใน Node ได้ =====
import fs from "fs"; import path from "path"; import { JSDOM } from "jsdom";

export const SRC = "..";
const SANDBOX = path.join(process.cwd(), "sandbox");

const MAP = {
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js": "../fake/app.mjs",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js": "../fake/auth-sdk.mjs",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js": "../fake/firestore.mjs",
};

export function buildSandbox() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(SANDBOX, { recursive: true });
  for (const f of fs.readdirSync(SRC)) {
    if (!/\.(js|html|css)$/.test(f)) continue;
    let s = fs.readFileSync(path.join(SRC, f), "utf8");
    for (const [from, to] of Object.entries(MAP)) s = s.split(from).join(to);
    s = s.replace(/from "\.\/([a-z-]+)\.js"/g, 'from "./$1.mjs"');
    fs.writeFileSync(path.join(SANDBOX, f.replace(/\.js$/, ".mjs")), s);
  }
  return SANDBOX;
}

export function makeDom(page) {
  const html = fs.readFileSync(path.join(SRC, page), "utf8");
  const dom = new JSDOM(html, { url: "https://908wayu-svg.github.io/qqshop/" + page, pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ["window", "document", "CustomEvent", "Event", "localStorage",
                   "HTMLElement", "Node", "Image", "FileReader", "getComputedStyle", "MutationObserver"]) {
    try { globalThis[k] = w[k]; } catch { Object.defineProperty(globalThis, k, { value: w[k], configurable: true }); }
  }
  try { Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true }); } catch {}
  try { Object.defineProperty(globalThis, "location", { value: w.location, configurable: true }); } catch {}
  globalThis.alert = (...a) => { globalThis.__alerts.push(a.join(" ")); };
  globalThis.confirm = () => globalThis.__confirm;
  globalThis.prompt = () => globalThis.__prompt;
  w.alert = globalThis.alert; w.confirm = globalThis.confirm; w.prompt = globalThis.prompt;
  globalThis.__alerts = []; globalThis.__confirm = true; globalThis.__prompt = null;
  return dom;
}

// i18n.js เป็นสคริปต์ธรรมดา ต้องรันให้ตัวแปร t/money/getLang เป็น global
export function loadI18n() {
  const src = fs.readFileSync(path.join(SRC, "i18n.js"), "utf8");
  const fn = new Function(src + "\n;return { t, money, getLang, setLang, toggleLang, applyLang };");
  const api = fn();
  Object.assign(globalThis, api);
  globalThis.window.t = api.t; globalThis.window.money = api.money;
  globalThis.window.getLang = api.getLang; globalThis.window.toggleLang = api.toggleLang;
  api.applyLang();
  loadImgHelper();
  return api;
}

// img.js เป็นสคริปต์ธรรมดาเหมือนกัน
export function loadImgHelper() { return runClassic("ui.js"); }

// สคริปต์ธรรมดา (app.js) — รันในบริบท global เดียวกัน
export function runClassic(file) {
  const src = fs.readFileSync(path.join(SRC, file), "utf8");
  const names = [...src.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)/gm)].map(m => m[1]);
  const consts = [...src.matchAll(/^const ([A-Za-z0-9_]+) =/gm)].map(m => m[1]);
  const all = [...new Set([...names, ...consts])];
  const fn = new Function(src + "\n;return {" + all.join(",") + "};");
  const api = fn();
  Object.assign(globalThis, api);
  for (const [k, v] of Object.entries(api)) globalThis.window[k] = v;
  return api;
}

export const tick = (n = 3) => new Promise(r => { let i = 0; const step = () => (++i >= n ? r() : setTimeout(step, 0)); step(); });

// ===== ทำให้คนที่ล็อกอินอยู่กลายเป็นแอดมิน (ใช้ในเทสต์) =====
// ของจริงต้องผ่านเซิร์ฟเวอร์: /admin/bootstrap (ครั้งแรก) หรือ /admin/role
// สิทธิ์ต้องครบทั้งสองอย่างเสมอ — custom claim ในโทเคน + role ในเอกสารสมาชิก
export async function makeAdmin(QQ, store) {
  const uid = QQ.user.uid;
  const cur = store.raw("users/" + uid) || {};
  store.state.docs.set("users/" + uid, { ...cur, role: "admin" });
  store.setClaims(uid, { admin: true });
  await QQ.refreshClaims();
  return uid;
}
