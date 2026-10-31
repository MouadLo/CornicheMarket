// Static server for the web export, gzip like a CDN would. SPA fallback.
const http = require("http"), fs = require("fs"), path = require("path"), zlib = require("zlib");
const root = "/tmp/eff-dist";
const types = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".ttf": "font/ttf", ".json": "application/json", ".ico": "image/x-icon", ".wav": "audio/wav" };
const cache = new Map();
http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, "index.html");
  const type = types[path.extname(p)] || "application/octet-stream";
  if (/gzip/.test(req.headers["accept-encoding"] || "") && /text|json/.test(type)) {
    if (!cache.has(p)) cache.set(p, zlib.gzipSync(fs.readFileSync(p)));
    res.writeHead(200, { "Content-Type": type, "Content-Encoding": "gzip" });
    return res.end(cache.get(p));
  }
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(p).pipe(res);
}).listen(8120, "127.0.0.1", () => console.log("serving 8120"));
