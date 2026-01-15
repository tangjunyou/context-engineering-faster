import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function exec(command: string) {
  execSync(command, { stdio: "inherit" });
}

const ext = process.platform === "win32" ? ".exe" : "";
const targetTriple = execSync("rustc --print host-tuple", {
  stdio: ["ignore", "pipe", "inherit"],
})
  .toString()
  .trim();

if (!targetTriple) {
  throw new Error("Failed to determine Rust host target triple");
}

exec("cargo build --release --manifest-path server-rs/Cargo.toml");

const src = path.join("server-rs", "target", "release", `server-rs${ext}`);
if (!fs.existsSync(src)) {
  throw new Error(`Missing sidecar binary: ${src}`);
}

const destDir = path.join("src-tauri", "binaries");
fs.mkdirSync(destDir, { recursive: true });
const dest = path.join(destDir, `server-rs-${targetTriple}${ext}`);

fs.copyFileSync(src, dest);
if (process.platform !== "win32") {
  fs.chmodSync(dest, 0o755);
}

console.log(`Sidecar ready: ${dest}`);
