import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const children = [
  ["node_modules/tsx/dist/cli.mjs", "server/index.ts", "--test-purchases"],
  [
    "node_modules/vite/bin/vite.js",
    "--mode",
    "live",
    "--host",
    "127.0.0.1",
    "--port",
    "8095",
  ],
].map((args) =>
  spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) child.on("exit", (code) => stop(code ?? 1));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
