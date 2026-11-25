const http = require("node:http");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { networkInterfaces } = require("node:os");
const path = require("node:path");

const directory = existsSync(path.join(__dirname, "dist", "index.html"))
  ? path.join(__dirname, "dist") : __dirname;
const port = Number(process.env.TEMPO_PORT || 8080);
const sessions = new Map();
const lifetime = 4 * 60 * 60 * 1000;
const types = {
  "index.html": "text/html; charset=utf-8",
  "remote-control.js": "text/javascript; charset=utf-8",
  "qrcode.js": "text/javascript; charset=utf-8",
  "jsqr.js": "text/javascript; charset=utf-8",
  "sw.js": "text/javascript; charset=utf-8",
  "manifest.webmanifest": "application/manifest+json",
  "icon-192.png": "image/png",
  "icon-512.png": "image/png",
};
function localAddresses() {
  try {
    return Object.values(networkInterfaces()).flat()
      .filter(net => net.family === "IPv4" && !net.internal)
      .map(net => net.address);
  } catch {
    return [];
  }
}
const ipAddresses = localAddresses();
const allowedHosts = new Set(["localhost", "127.0.0.1", ...ipAddresses].map(ip => ip + ":" + port));

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (Buffer.byteLength(text) > 65536) throw Error("Payload too large");
  }
  return JSON.parse(text);
}

async function sync(request, response, url) {
  const token = request.headers["x-tempo-session"];
  if (!/^[a-f0-9]{64}$/.test(token || "")) return json(response, 403, []);
  const method = request.method;
  if (method === "GET") {
    const row = sessions.get(token);
    return json(response, 200, row && row.expires > Date.now() ? [row] : []);
  }
  if (method === "DELETE") {
    sessions.delete(token);
    return json(response, 200, []);
  }
  if (method !== "POST" && method !== "PATCH") return json(response, 405, []);
  const body = await readBody(request);
  if (!body || typeof body !== "object") return json(response, 400, []);
  if (method === "POST") {
    if (sessions.has(token) || sessions.size >= 128 || !body.snapshot) return json(response, 409, []);
    const session = { expires: Date.now() + lifetime, snapshot: body.snapshot, command: null };
    sessions.set(token, session);
    return json(response, 201, [session]);
  }
  const row = sessions.get(token);
  if (!row || row.expires <= Date.now()) return json(response, 200, []);
  if (url.searchParams.has("command") && row.command !== null) return json(response, 200, []);
  if (Object.hasOwn(body, "snapshot")) row.snapshot = body.snapshot;
  if (Object.hasOwn(body, "command")) row.command = body.command;
  return json(response, 200, [row]);
}

setInterval(() => {
  for (const [token, row] of sessions) if (row.expires <= Date.now()) sessions.delete(token);
}, 60_000).unref();

http.createServer(async (request, response) => {
  try {
    const host = request.headers.host;
    if (!allowedHosts.has(host)) return json(response, 403, []);
    const origin = "http://" + host;
    if (request.headers.origin && request.headers.origin !== origin) return json(response, 403, []);
    const url = new URL(request.url, origin);
    if (url.pathname === "/api/sessao") return await sync(request, response, url);
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!Object.hasOwn(types, file) || request.method !== "GET") return json(response, 404, []);
    let contents = await fs.readFile(path.join(directory, file));
    if (file === "index.html") contents = contents.toString().replace("<head>", '<head>\n<meta name="tempo-lan" content="active">');
    response.writeHead(200, { "Content-Type": types[file], "Cache-Control": "no-store" });
    response.end(contents);
  } catch {
    if (!response.headersSent) json(response, 400, []);
  }
}).listen(port, "0.0.0.0", () => {
  console.log("Tempo na Tela — abra o mesmo endereço no visor e no celular:");
  for (const ip of ipAddresses) console.log("http://" + ip + ":" + port + "/");
  if (!ipAddresses.length) console.log("Conecte o computador à rede Wi-Fi e reinicie o servidor.");
});
