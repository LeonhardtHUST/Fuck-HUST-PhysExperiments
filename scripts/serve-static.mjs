#!/usr/bin/env node
/**
 * Dependency-free static file server for the exported frontend.
 *
 * `next start` cannot be used here: frontend/next.config.ts sets
 * `output: "export"`, so `npm run build` produces frontend/out instead of a
 * server build. The dev scripts use this server for their production mode.
 *
 * Usage: node scripts/serve-static.mjs <dir> <port> [host]
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const [, , dirArg, portArg, hostArg] = process.argv;
if (!dirArg || !portArg) {
  console.error("usage: node scripts/serve-static.mjs <dir> <port> [host]");
  process.exit(2);
}

const root = path.resolve(dirArg);
const port = Number(portArg);
const host = hostArg || "127.0.0.1";

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`invalid port: ${portArg}`);
  process.exit(2);
}

const MIME = new Map(
  Object.entries({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".wasm": "application/wasm",
    ".mp4": "video/mp4",
    ".webmanifest": "application/manifest+json",
  }),
);

const contentType = (file) =>
  MIME.get(path.extname(file).toLowerCase()) ?? "application/octet-stream";

const statOrNull = async (target) => {
  try {
    return await stat(target);
  } catch {
    return null;
  }
};

const isInsideRoot = (target) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const cacheControl = (urlPath) =>
  urlPath.startsWith("/_next/static/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

/** Streams one file; returns false (without touching the response) if it is gone. */
async function sendFile(req, res, file, status, urlPath) {
  const info = await statOrNull(file);
  if (!info?.isFile()) return false;

  res.writeHead(status, {
    "Content-Type": contentType(file),
    "Content-Length": info.size,
    "Cache-Control": cacheControl(urlPath),
  });

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  await new Promise((resolve) => {
    const stream = createReadStream(file);
    stream.on("error", () => {
      res.destroy();
      resolve();
    });
    res.on("close", resolve);
    stream.pipe(res);
  });
  return true;
}

const server = createServer(async (req, res) => {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    sendText(res, 405, "Method not allowed");
    return;
  }

  let urlPath;
  let search = "";
  try {
    const url = new URL(req.url, `http://${host}:${port}`);
    urlPath = decodeURIComponent(url.pathname);
    search = url.search;
  } catch {
    sendText(res, 400, "Bad request");
    return;
  }

  const target = path.resolve(root, `.${path.posix.normalize(urlPath)}`);
  if (!isInsideRoot(target)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  let status = 200;
  const info = await statOrNull(target);

  if (info?.isFile()) {
    if (!(await sendFile(req, res, target, 200, urlPath))) {
      sendText(res, 404, "Not found");
      status = 404;
    }
  } else if (info?.isDirectory() && !urlPath.endsWith("/")) {
    // trailingSlash: true — directories are addressed with a trailing slash.
    res.writeHead(301, { Location: `${urlPath}/${search}` });
    res.end();
    status = 301;
  } else if (info?.isDirectory()) {
    if (!(await sendFile(req, res, path.join(target, "index.html"), 200, urlPath))) {
      sendText(res, 404, "Not found");
      status = 404;
    }
  } else {
    const notFoundPage = path.join(root, "404.html");
    const served =
      (await statOrNull(notFoundPage))?.isFile() &&
      (await sendFile(req, res, notFoundPage, 404, "/404.html"));
    if (!served) sendText(res, 404, "Not found");
    status = 404;
  }

  console.log(`${method} ${urlPath} ${status}`);
});

server.on("error", (error) => {
  console.error(`static server error: ${error.message}`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`serving ${root} on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
