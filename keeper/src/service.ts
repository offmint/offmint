// Always-on paper-mode service (Railway): runs the live paper loop and serves its results read-only over HTTP.
// Deterministic, read-only against mainnet, no keys. Env: PORT, PAPER_OUT_DIR (volume), LOG_DIR, RH_MAINNET_RPC.
//   GET /health            -> { ok, lastTickAgoSec, ticks, restarts, universe, uptimeSec }
//   GET /paper/index.json  -> list of paper epochs;  GET /paper/<date>-<TICKER>.json -> one epoch
//   GET /basket.json       -> the detector's current basket (SPEC §3.7), for the web /monitor page
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { live, liveStatus } from "./paper.js";
import { runDetector } from "../detector/detector.js";

const OUT = resolve(process.env.PAPER_OUT_DIR ?? "/data/paper");
const PORT = Number(process.env.PORT ?? 8080);
const STALE_SEC = 5 * 60; // /health fails if the loop hasn't ticked for 5 minutes
mkdirSync(OUT, { recursive: true });
const started = Date.now();
let restarts = 0;

async function runForever() {
  for (;;) {
    try {
      await live(undefined, OUT);
    } catch (e) {
      restarts++;
      console.error(JSON.stringify({ event: "paper-crashed", restarts, msg: String(e).slice(0, 400) }));
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}

const json = (res: any, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/health" || url.pathname === "/") {
    const ago = liveStatus.lastTickAt ? Math.round((Date.now() - liveStatus.lastTickAt) / 1000) : null;
    // healthy while starting up (first tick can take a few minutes) and while ticking
    const ok = ago === null ? Date.now() - started < 15 * 60_000 : ago < STALE_SEC;
    return json(res, ok ? 200 : 503, {
      ok,
      service: "offmint paper mode (read-only, deterministic keeper simulation)",
      lastTickAgoSec: ago,
      ticks: liveStatus.ticks,
      restarts,
      lastTick: liveStatus.lastTick,
      detector: (globalThis as any).__detectorStatus,
      uptimeSec: Math.round((Date.now() - started) / 1000),
    });
  }
  if (url.pathname === "/basket.json") {
    const f = resolve(process.env.BASKET_PATH ?? "/data/basket.json");
    if (!existsSync(f)) return json(res, 404, { error: "basket not built yet" });
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
    return res.end(readFileSync(f));
  }
  const m = url.pathname.match(/^\/paper\/([A-Za-z0-9.\-]+\.json)$/);
  if (m) {
    const f = join(OUT, basename(m[1])); // basename: no path traversal
    if (!existsSync(f)) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
    return res.end(readFileSync(f));
  }
  json(res, 404, { error: "not found", routes: ["/health", "/basket.json", "/paper/index.json", "/paper/<date>-<TICKER>.json"] });
}).listen(PORT, () => console.log(JSON.stringify({ event: "service-start", port: PORT, out: OUT })));

// Detector (SPEC §3.7): refresh the basket at start and every 6h; a failed run keeps the last good basket.
const detectorStatus = { lastRunAt: 0, members: 0, error: null as string | null };
async function detectOnce() {
  try {
    const doc = await runDetector();
    Object.assign(detectorStatus, { lastRunAt: Date.now(), members: doc.counts.members, error: null });
    console.log(JSON.stringify({ event: "basket", ...doc.counts, members: doc.members.map((m: any) => m.ticker) }));
  } catch (e) {
    detectorStatus.error = String(e).slice(0, 300);
    console.error(JSON.stringify({ event: "detector-failed", msg: detectorStatus.error }));
  }
}
(globalThis as any).__detectorStatus = detectorStatus;
void (async () => {
  await detectOnce();
  setInterval(detectOnce, 6 * 3600_000);
  void runForever();
})();
