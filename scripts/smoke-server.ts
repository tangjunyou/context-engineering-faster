import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

async function sleep(ms: number) {
  await new Promise(r => setTimeout(r, ms));
}

async function waitFor(url: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

const ext = process.platform === "win32" ? ".exe" : "";
const bin = path.join("server-rs", "target", "release", `server-rs${ext}`);
if (!fs.existsSync(bin)) {
  throw new Error(`Missing server binary: ${bin}`);
}

const staticDir = path.join("dist", "public");
if (!fs.existsSync(staticDir)) {
  throw new Error(`Missing static dir: ${staticDir}`);
}

const port = randomInt(31000, 39999);
const base = `http://127.0.0.1:${port}`;

const child = spawn(bin, ["--port", String(port), "--static-dir", staticDir], {
  stdio: "inherit",
  env: { ...process.env, RUST_LOG: "server_rs=info" },
});

try {
  await waitFor(`${base}/api/healthz`, 10000);

  const res = await fetch(`${base}/api/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nodes: [
        {
          id: "n1",
          label: "System",
          kind: "system",
          content: "Hello {{name}}",
        },
      ],
      variables: [{ id: "v1", name: "name", value: "Alice" }],
      outputStyle: "labeled",
    }),
  });
  if (!res.ok) {
    throw new Error(`execute failed: ${res.status}`);
  }
  const json = await res.json();
  if (!json.segments) {
    throw new Error("execute response missing segments");
  }
} finally {
  child.kill();
}
