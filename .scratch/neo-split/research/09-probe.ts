// ทดสอบสิทธิ์ macOS เมื่อ launchd เปิด: เขียนผลลง log ไม่พิมพ์เนื้อหาไฟล์
import { readdirSync, openSync, closeSync, appendFileSync, mkdirSync } from "fs";
import { spawnSync } from "child_process";
const home = process.env.HOME!, log = home + "/Library/Logs/NeoProbe/probe.log";
mkdirSync(home + "/Library/Logs/NeoProbe", { recursive: true });
const t = (name: string, f: () => unknown) => { try { f(); return [name, "ok"]; } catch (e: any) { return [name, e.code || String(e)]; } };
const r = Object.fromEntries([
  t("fda_tccdb", () => closeSync(openSync("/Library/Application Support/com.apple.TCC/TCC.db", "r"))),
  t("fda_mail", () => readdirSync(home + "/Library/Mail")),
  t("desktop", () => readdirSync(home + "/Desktop")),
  t("documents", () => readdirSync(home + "/Documents")),
  t("downloads", () => readdirSync(home + "/Downloads")),
  ["child_ls_desktop", spawnSync("/bin/ls", [home + "/Desktop"]).status === 0 ? "ok" : "denied"],
]);
appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), mode: (process.argv[2] || "?") + "-rebuilt", ppid: process.ppid, r }) + "\n");
