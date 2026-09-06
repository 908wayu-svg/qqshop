import { execFileSync } from "child_process";
const NL = String.fromCharCode(10);
const tests = [
  ["t1-auth.mjs", []], ["t2-admin.mjs", []], ["t3-worker.mjs", []], ["t4-angpao.mjs", []],
  ["t5-shop.mjs", []], ["t6-purchases.mjs", []], ["t7-admin-ui.mjs", []],
  ["t8-wallet.mjs", []], ["t9-gates.mjs", ["member"]], ["t9-gates.mjs", ["guest"]],
  ["t10-load.mjs", []], ["t11-images.mjs", []], ["t12-login.mjs", []], ["t13-overlay.mjs", []],
  ["t15-contact.mjs", []], ["t16-stickers.mjs", []],
  ["t17-categories.mjs", []], ["t18-categories-admin.mjs", []], ["t19-mobile.mjs", []],
  ["t20-customer-info.mjs", []], ["t21-seo.mjs", []], ["t22-search.mjs", []], ["t23-terms.mjs", []], ["t24-admin-security.mjs", []], ["t25-slip-ocr.mjs", []], ["t26-i18n.mjs", []], ["t27-dom-wiring.mjs", []], ["t28-rules-sync.mjs", []], ["t29-dark-mode.mjs", []], ["t30-copy-button.mjs", []], ["t31-cross-os.mjs", []], ["t32-admin-tools.mjs", []], ["t33-history-cap.mjs", []], ["t34-stale-html.mjs", []], ["t35-shared-rules.mjs", []], ["t36-privacy.mjs", []],
  ["t14-offline.mjs", ["purchases"]], ["t14-offline.mjs", ["wallet"]], ["t14-offline.mjs", ["admin"]],
];
let P = 0, F = 0, bad = [];
for (const [f, args] of tests) {
  let out = "", code = 0;
  try { out = execFileSync(process.execPath, ["--max-old-space-size=4096", f, ...args], { encoding: "utf8", stdio: "pipe" }); }
  catch (e) { out = (e.stdout || "") + (e.stderr || ""); code = e.status ?? 1; }
  const all = [...out.matchAll(/สรุป[^:\n]*: ผ่าน (\d+) \/ ไม่ผ่าน (\d+)/g)];
  const m = all[all.length - 1];
  const fails = out.split("\n").filter(l => l.includes("  XX  "));
  if (!m) { console.log("ล้มเหลว " + f + "\n" + out.split("\n").slice(-15).join("\n")); F += 1; bad.push(f); continue; }
  P += +m[1]; F += +m[2];
  // ไฟล์เทสอาจพิมพ์สรุปว่าผ่านหมด แล้วค่อยล้มทีหลัง (unhandled rejection / throw ตอนปิดโปรแกรม)
  // ถ้าดูแต่บรรทัดสรุปอย่างเดียวจะรายงานว่า "ผ่าน" ทั้งที่ node ออกด้วยรหัสผิดพลาด
  const crashed = code !== 0 && +m[2] === 0;
  if (crashed) { F += 1; bad.push(f); }
  console.log(((+m[2] || crashed) ? "XX " : "ok ") + (f + " " + args.join(" ")).padEnd(24) + " ผ่าน " + m[1] + " / ไม่ผ่าน " + m[2]);
  if (crashed) console.log("     XX  ล้มหลังพิมพ์สรุป (exit code " + code + ")" + NL + out.split(NL).slice(-8).map(l => "       " + l).join(NL));
  fails.forEach(l => console.log("     " + l.trim()));
}
console.log("\n===== รวมทั้งหมด: ผ่าน " + P + " / ไม่ผ่าน " + F + " =====");
process.exitCode = F ? 1 : 0;
