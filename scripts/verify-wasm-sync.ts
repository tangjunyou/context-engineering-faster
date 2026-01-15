import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

async function sha256(filePath: string) {
  const buf = await fs.readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const repoRoot = process.cwd();

  const frontendWasm = path.join(
    repoRoot,
    "client",
    "src",
    "lib",
    "wasm",
    "context_engine_bg.wasm"
  );
  const pkgWasm = path.join(
    repoRoot,
    "context-engine",
    "pkg",
    "context_engine_bg.wasm"
  );

  const hasFrontendWasm = await fileExists(frontendWasm);
  const hasPkgWasm = await fileExists(pkgWasm);

  if (!hasFrontendWasm) {
    throw new Error(`缺少前端 WASM 产物：${frontendWasm}`);
  }

  if (!hasPkgWasm) {
    return;
  }

  const [frontendHash, pkgHash] = await Promise.all([
    sha256(frontendWasm),
    sha256(pkgWasm),
  ]);

  if (frontendHash !== pkgHash) {
    throw new Error(
      [
        "检测到 WASM 产物不一致：",
        `- client/src/lib/wasm/context_engine_bg.wasm: ${frontendHash}`,
        `- context-engine/pkg/context_engine_bg.wasm: ${pkgHash}`,
        "请重新构建并同步 WASM 产物，避免线上使用的 WASM 与源码不匹配。",
      ].join("\n")
    );
  }
}

main().catch(err => {
  console.error(String(err?.stack || err));
  process.exitCode = 1;
});
