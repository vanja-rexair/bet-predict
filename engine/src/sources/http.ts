const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ograničava broj zahteva u sekundi da ne opterećujemo besplatne servise. */
let nextSlot = 0;
async function throttle(rps: number): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + 1000 / rps;
  if (slot > now) await sleep(slot - now);
}

interface Opts { rps?: number; tries?: number; timeout?: number }

/** Vraća null za 404; ostale greške baca nakon nekoliko pokušaja. */
export async function request(url: string, { rps = 6, tries = 4, timeout = 60000 }: Opts = {}): Promise<Response | null> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    await throttle(rps);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      if (res.ok) return res;
      if (res.status === 404) return null;
      lastErr = new Error(`HTTP ${res.status} ${url}`);
      if (res.status === 401 || res.status === 403) break; // servis odbija: ne insistiramo
    } catch (e) {
      lastErr = e;
    }
    await sleep(800 * 2 ** i);
  }
  throw lastErr;
}
export async function getJson<T = any>(url: string, opts?: Opts): Promise<T | null> {
  const r = await request(url, opts);
  return r ? ((await r.json()) as T) : null;
}
export async function getText(url: string): Promise<string | null> {
  const r = await request(url, { timeout: 240000 });
  return r ? r.text() : null;
}
