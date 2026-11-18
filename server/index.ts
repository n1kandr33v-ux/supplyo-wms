import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { resolve, extname, sep } from "node:path";
import { createApp } from "./app.ts";
const directory = resolve(process.env.DATA_DIR ?? ".local-data");
await mkdir(directory, { recursive: true });
const keyPath = resolve(directory, "encryption.key");
try {
  await writeFile(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
}
const key = await readFile(keyPath);
if (key.length !== 32) throw new Error("Invalid encryption key");
const { app } = await createApp({
  dataDir: resolve(directory, "postgres"),
  databaseUrl: process.env.DATABASE_URL,
  key,
  testPurchases: process.argv.includes("--test-purchases") || process.env.TEST_PURCHASES === "1",
  origins: process.env.PUBLIC_ORIGIN ? [process.env.PUBLIC_ORIGIN] : process.argv.includes("--serve-web") ? [`http://127.0.0.1:${process.env.PORT ?? 3040}`, `http://localhost:${process.env.PORT ?? 3040}`] : undefined,
});
if (process.argv.includes("--serve-web")) {
  const webRoot = resolve("dist");
  const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon" };
  app.get("/*", async (req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({error: "Не найдено"});
    let path: string;
    try { path = resolve(webRoot, "." + decodeURIComponent(req.url.split("?")[0])); }
    catch { return reply.code(400).send(); }
    if (path !== webRoot && !path.startsWith(webRoot + sep)) return reply.code(404).send();
    try {
      const body = await readFile(path === webRoot ? resolve(webRoot, "index.html") : path);
      if (body.length > 1024 && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
        reply.header("Content-Encoding", "gzip").header("Vary", "Accept-Encoding");
        return reply.type(mime[extname(path)] ?? "application/octet-stream").send(gzipSync(body));
      }
      return reply.type(mime[extname(path)] ?? (path === webRoot ? mime[".html"] : "application/octet-stream")).send(body);
    } catch { return reply.code(404).send(); }
  });
}
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 3040) });
console.log(`supply API: http://127.0.0.1:${process.env.PORT ?? 3040}`);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
