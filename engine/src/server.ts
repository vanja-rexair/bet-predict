import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR, PUBLIC_DIR, ROOT, WEB_DIST } from './config.ts';

/**
 * Pozadinski servis: služi aplikaciju na mreži i neprekidno prati mečeve, nezavisno od toga
 * da li je aplikacija otvorena. Posao se radi u zasebnom procesu da server ne staje tokom treninga.
 */
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const MIN = 60_000;

let running = false, lastRun = 0, lastError = '', nextAt = 0;
let timer: NodeJS.Timeout | undefined;

/**
 * Kad mečeve prati GitHub, adresa njegovih podataka stoji u data/remote.txt i računar ih samo preuzima,
 * da ne bi postojala dva različita zapisa uspešnosti.
 */
const REMOTE_FILE = path.join(DATA_DIR, 'remote.txt');
const remote = fs.existsSync(REMOTE_FILE) ? fs.readFileSync(REMOTE_FILE, 'utf8').trim().replace(/\/+$/, '') : '';
const FILES = ['today', 'events', 'stats', 'history', 'recent', 'misses', 'teams'];
async function mirror(): Promise<void> {
  if (running) return;
  running = true;
  lastRun = Date.now();
  try {
    const got = await Promise.all(FILES.map(async (n) => {
      const r = await fetch(`${remote}/data/${n}.json`, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`${n}: HTTP ${r.status}`);
      const text = await r.text();
      JSON.parse(text);
      return [n, text] as const;
    }));
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    for (const [n, text] of got) {
      const f = path.join(PUBLIC_DIR, `${n}.json`);
      fs.writeFileSync(f + '.tmp', text);
      fs.renameSync(f + '.tmp', f);
    }
    lastError = '';
  } catch (e) {
    lastError = (e as Error).message;
  } finally {
    running = false;
  }
}

function runUpdate(): Promise<void> {
  if (remote) return mirror();
  if (running) return Promise.resolve();
  running = true;
  lastRun = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'engine/src/cli.ts'), 'update'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let err = '';
    const kill = setTimeout(() => child.kill(), 45 * MIN); // zaglavljena provera ne sme da zaustavi praćenje
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => { err += d; process.stderr.write(d); });
    child.on('close', (code) => {
      clearTimeout(kill);
      running = false;
      lastError = code === 0 ? '' : err.trim().split('\n').slice(-3).join(' ') || `kod ${code}`;
      resolve();
    });
    child.on('error', (e) => { running = false; lastError = e.message; resolve(); });
  });
}

/** Češće proverava kad se igra ili kad meč uskoro počinje. */
function interval(): number {
  if (lastError || remote) return 5 * MIN;
  try {
    const { games } = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'today.json'), 'utf8')) as { games: { start: string; live: { state: string }; result: unknown }[] };
    const now = Date.now();
    if (games.some((g) => !g.result && Date.parse(g.start) < now && now - Date.parse(g.start) < 5 * 3600e3)) return 2 * MIN;
    const soon = games.map((g) => Date.parse(g.start) - now).filter((d) => d > 0).sort((a, b) => a - b)[0];
    if (soon !== undefined && soon < 2 * 3600e3) return Math.max(MIN, Math.min(4 * MIN, soon));
    if (soon !== undefined && soon < 8 * 3600e3) return 10 * MIN;
  } catch { /* još nema podataka */ }
  return 20 * MIN;
}
async function loop(): Promise<void> {
  await runUpdate();
  const ms = interval();
  nextAt = Date.now() + ms;
  timer = setTimeout(loop, ms);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
function sendFile(res: http.ServerResponse, root: string, rel: string, cache: string): boolean {
  const f = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (f !== root && !f.startsWith(root + path.sep)) return false;
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return false;
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] ?? 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(f).pipe(res);
  return true;
}

const server = http.createServer((req, res) => {
  let p: string;
  try { p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  // Android aplikacija čita iste podatke sa drugog porekla.
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' }).end(); return; }
  const json = (code: number, b: unknown) => res.writeHead(code, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' }).end(JSON.stringify(b));
  if (p === '/api/status') return void json(200, { running, lastRun, nextAt, error: lastError });
  if (p === '/api/refresh' && req.method === 'POST') {
    if (running || Date.now() - lastRun < MIN) return void json(202, { running, queued: false });
    clearTimeout(timer);
    void loop();
    return void json(202, { running: true, queued: true });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (p.startsWith('/data/')) {
    if (!sendFile(res, PUBLIC_DIR, p.slice(6), 'no-cache')) json(404, { error: 'nema podataka' });
    return;
  }
  if (sendFile(res, WEB_DIST, p === '/' ? 'index.html' : p.slice(1), p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')) return;
  if (!path.extname(p) && sendFile(res, WEB_DIST, 'index.html', 'no-cache')) return;
  res.writeHead(404).end('Nije pronađeno. Ako je prvo pokretanje: npm run build');
});

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} je zauzet: servis već radi ili promenite PORT.` : e);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Aplikacija: http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    for (const l of Object.values(os.networkInterfaces())) for (const a of l ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`Na telefonu (ista mreža): http://${a.address}:${PORT}`);
    }
  }
  if (!process.env.BP_NO_TRACK) void loop();
});
