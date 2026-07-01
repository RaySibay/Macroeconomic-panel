import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

import worker from "../src/worker.js";

const root = process.cwd();
const publicDir = join(root, "public");
const port = Number(process.env.PORT ?? 8787);

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

const assets = {
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const target = normalize(join(publicDir, pathname));
    if (!target.startsWith(publicDir)) return new Response("Not found", { status: 404 });

    try {
      const body = await readFile(target);
      return new Response(body, {
        headers: { "content-type": mime.get(extname(target)) ?? "application/octet-stream" }
      });
    } catch {
      const body = await readFile(join(publicDir, "index.html"));
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
  }
};

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined
  });
  const response = await worker.fetch(request, { ASSETS: assets });
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body) {
    const body = Buffer.from(await response.arrayBuffer());
    res.end(body);
  } else {
    res.end();
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Local preview: http://127.0.0.1:${port}`);
});
