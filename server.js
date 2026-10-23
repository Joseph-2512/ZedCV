"use strict";
/* ZedCV server. No dependencies, Node 18 or newer.
   - Serves the app (public/index.html) and the admin page (public/admin.html).
   - Records Airtel Money payments (from a forwarded SMS or typed in by hand).
   - Checks a customer's transaction ID against those records.
   - Only after a payment is confirmed does it send the file-making code (engine.js). */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const TOKEN_SECRET = process.env.TOKEN_SECRET || ADMIN_KEY;
const PRICE = Number(process.env.PRICE_KWACHA || 5);
const ACCESS_HOURS = Number(process.env.ACCESS_HOURS || 24);
const MAX_ENGINE_LOADS = Number(process.env.MAX_ENGINE_LOADS || 30);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "payments.json");

if (ADMIN_KEY.length < 12) {
  console.error("Set ADMIN_KEY to a secret of at least 12 characters, for example: ADMIN_KEY=$(openssl rand -hex 16) node server.js");
  process.exit(1);
}

/* ---------- storage ---------- */
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
let db = { payments: {}, unparsed: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))); } catch (e) { /* first run */ }
let writing = false, dirty = false;
function save() {
  dirty = true;
  if (writing) return;
  writing = true; dirty = false;
  const tmp = DATA_FILE + ".tmp";
  fs.writeFile(tmp, JSON.stringify(db, null, 2), (err) => {
    if (!err) fs.rename(tmp, DATA_FILE, () => { writing = false; if (dirty) save(); });
    else { writing = false; console.error("save failed", err.message); }
  });
}

/* ---------- helpers ---------- */
const normTxn = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, "");
const isTxn = (s) => /^[A-Z0-9][A-Z0-9.\-]{7,39}$/.test(s);
const sign = (s) => crypto.createHmac("sha256", TOKEN_SECRET).update(s).digest("base64url");
function makeToken(txn, exp) { const body = Buffer.from(txn + "|" + exp).toString("base64url"); return body + "." + sign(body); }
function readToken(tok) {
  const [body, sig] = String(tok || "").split(".");
  if (!body || !sig) return null;
  const good = sign(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const [txn, exp] = Buffer.from(body, "base64url").toString().split("|");
  if (!txn || Date.now() > Number(exp)) return null;
  return { txn, exp: Number(exp) };
}
function adminOk(req) {
  const k = String(req.headers["x-admin-key"] || "");
  return k.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY));
}
const hits = new Map();
function limited(ip, max, windowMs) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 600000)) hits.delete(k); }, 600000).unref();

function body(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", (c) => { n += c.length; if (n > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function send(res, code, data, type) {
  const isObj = typeof data === "object" && !Buffer.isBuffer(data);
  res.writeHead(code, {
    "content-type": type || (isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8"),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
  res.end(isObj ? JSON.stringify(data) : data);
}
const ip = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

/* ---------- reading an Airtel Money "received" SMS ----------
   Airtel changes its wording from time to time. Test this with a real SMS from your phone
   (the admin page has a "test an SMS" box) and adjust the patterns if it misses. */
function parseSms(text) {
  const t = String(text || "").replace(/\s+/g, " ");
  const idMatch =
    t.match(/(?:trans(?:action)?\s*(?:id|no\.?|number|ref)|txn\s*id|tid|ref(?:erence)?(?:\s*(?:id|no\.?))?)\s*[:#\-]?\s*([A-Za-z0-9][A-Za-z0-9.\-]{6,39})/i);
  const amtMatch = t.match(/(?:ZMW|ZK|K)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i) || t.match(/received\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  const fromMatch = t.match(/from\s+(?:[A-Za-z .'-]{2,40}?\s)?((?:\+?260|0)?9[0-9]{8})/i);
  if (!idMatch || !amtMatch) return null;
  return {
    txn: normTxn(idMatch[1]).replace(/[.\-]+$/, ""),
    amount: Number(amtMatch[1].replace(/,/g, "")),
    from: fromMatch ? fromMatch[1] : ""
  };
}
function record(txn, amount, from, source) {
  txn = normTxn(txn);
  if (!isTxn(txn)) return { ok: false, error: "Transaction ID looks wrong." };
  if (db.payments[txn]) return { ok: true, duplicate: true, txn };
  db.payments[txn] = { amount, from: from || "", receivedAt: Date.now(), source, claimedAt: null, loads: 0 };
  save();
  return { ok: true, txn };
}

/* ---------- routes ---------- */
const PUBLIC = fs.existsSync(path.join(__dirname, "public")) ? path.join(__dirname, "public") : __dirname;
const readFile = (p) => fs.readFileSync(p);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;

    if (req.method === "GET" && (p === "/" || p === "/index.html")) return send(res, 200, readFile(path.join(PUBLIC, "index.html")), "text/html; charset=utf-8");
    if (req.method === "GET" && p === "/admin") return send(res, 200, readFile(path.join(PUBLIC, "admin.html")), "text/html; charset=utf-8");
    if (req.method === "GET" && p === "/healthz") return send(res, 200, "ok");

    /* Customer: check a transaction ID. */
    if (req.method === "POST" && p === "/api/verify") {
      if (limited(ip(req), 12, 10 * 60 * 1000)) return send(res, 429, { error: "Too many attempts. Wait a few minutes and try again." });
      let j; try { j = JSON.parse(await body(req)); } catch (e) { return send(res, 400, { error: "Bad request." }); }
      const txn = normTxn(j.txn);
      if (!isTxn(txn)) return send(res, 400, { error: "That does not look like an Airtel Money transaction ID. Copy it from your confirmation SMS." });
      const pay = db.payments[txn];
      if (!pay) return send(res, 404, { error: "We have not received that payment yet. Wait a minute and try again. Check that you sent it to the right number." });
      if (pay.amount < PRICE) return send(res, 402, { error: "That payment is less than K" + PRICE + ". Send the difference and contact us with both transaction IDs." });
      const now = Date.now();
      if (!pay.claimedAt) { pay.claimedAt = now; save(); }
      const exp = pay.claimedAt + ACCESS_HOURS * 3600 * 1000;
      if (now > exp) return send(res, 409, { error: "That transaction ID was already used and its " + ACCESS_HOURS + "-hour access has ended. Make a new payment to download again." });
      return send(res, 200, { token: makeToken(txn, exp), expires: exp });
    }

    /* Customer: file-making code, only with a valid token. */
    if (req.method === "GET" && p === "/api/engine") {
      const tok = readToken(url.searchParams.get("token"));
      const pay = tok && db.payments[tok.txn];
      if (!pay) return send(res, 401, "Payment session not valid.");
      if (pay.loads >= MAX_ENGINE_LOADS) return send(res, 403, "Too many downloads for this payment.");
      pay.loads++; save();
      return send(res, 200, readFile(path.join(__dirname, "engine.js")), "text/javascript; charset=utf-8");
    }

    /* Phone SMS forwarder posts here. Accepts JSON {text|message|body|sms} or plain text. */
    if (req.method === "POST" && p === "/api/ingest") {
      if (!adminOk(req)) return send(res, 401, { error: "Bad key." });
      const raw = await body(req);
      let text = raw;
      try { const j = JSON.parse(raw); text = j.text || j.message || j.body || j.sms || j.content || raw; } catch (e) { /* plain text */ }
      const parsed = parseSms(text);
      if (!parsed) {
        db.unparsed.push({ at: Date.now(), text: String(text).slice(0, 500) }); db.unparsed = db.unparsed.slice(-50); save();
        return send(res, 422, { error: "Could not read an amount and transaction ID from that text." });
      }
      const r = record(parsed.txn, parsed.amount, parsed.from, "sms");
      return send(res, r.ok ? 200 : 400, Object.assign({ parsed }, r));
    }

    /* Admin page API. */
    if (p.startsWith("/api/admin/")) {
      if (!adminOk(req)) return send(res, 401, { error: "Bad key." });
      if (req.method === "GET" && p === "/api/admin/payments") {
        const rows = Object.entries(db.payments).map(([txn, v]) => Object.assign({ txn }, v)).sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 200);
        return send(res, 200, { price: PRICE, rows, unparsed: db.unparsed.slice(-10).reverse() });
      }
      if (req.method === "POST" && p === "/api/admin/add") {
        const j = JSON.parse(await body(req));
        return send(res, 200, record(j.txn, Number(j.amount) || PRICE, j.from, "manual"));
      }
      if (req.method === "POST" && p === "/api/admin/test") {
        const j = JSON.parse(await body(req));
        return send(res, 200, { parsed: parseSms(j.text) });
      }
    }
    send(res, 404, "Not found");
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "Server error." });
  }
});
server.listen(PORT, () => console.log("ZedCV running on port " + PORT + ", price K" + PRICE));
