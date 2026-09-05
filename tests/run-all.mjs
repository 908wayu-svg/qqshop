import { execFileSync } from "child_process";
const tests = [
  ["t1-auth.mjs", []], ["t2-admin.mjs", []], ["t3-worker.mjs", []], ["t4-angpao.mjs", []],
  ["t5-shop.mjs", []], ["t6-purchases.mjs", []], ["t7-admin-ui.mjs", []],
  ["t8-wallet.mjs", []], ["t9-gates.mjs", ["member"]], ["t9-gates.mjs", ["guest"]],
  ["t10-load.mjs", []], ["t11-images.mjs", []], ["t12-login.mjs", []], ["t13-overlay.mjs", []],
  ["t15-contact.mjs", []], ["t16-stickers.mjs", []],
  ["t17-categories.mjs", []], ["t18-categories-admin.mjs", []], ["t19-mobile.mjs", []],
  ["t20-customer-info.mjs", []], ["t21-seo.mjs", []], ["t22-search.mjs", []], ["t23-terms.mjs", []], ["t24-admin-security.mjs", []],
  ["t14-offline.mjs", ["purchases"]], ["t14-offline.mjs", ["wallet"]], ["t14-offline.mjs", ["admin"]],
];
let P = 0, F = 0, bad = [];
for (const [f, args] of tests) {
  let out = "";
  try { out = execFileSync(process.execPath, ["--max-old-space-size=4096", f, ...args], { encoding: "utf8", stdio: "pipe" }); }
  catch (e) { out = (e.stdout || "") + (e.stderr || ""); }
  const all = [...out.matchAll(/สรุป[^:\n]*: ผ่าน (\d+) \/ ไม่ผ่าน (\d+)/g)];
  const m = all[all.length - 1];
  const fails = out.split("\n").filter(l => l.includes("  XX  "));
  if (!m) { console.log("ล้มเหลว " + f + "\n" + out.split("\n").slice(-15).join("\n")); F += 1; bad.push(f); continue; }
  P += +m[1]; F += +m[2];
  console.log((+m[2] ? "XX " : "ok ") + (f + " " + args.join(" ")).padEnd(24) + " ผ่าน " + m[1] + " / ไม่ผ่าน " + m[2]);
  fails.forEach(l => console.log("     " + l.trim()));
}
console.log("\n===== รวมทั้งหมด: ผ่าน " + P + " / ไม่ผ่าน " + F + " =====");
process.exitCode = F ? 1 : 0;
