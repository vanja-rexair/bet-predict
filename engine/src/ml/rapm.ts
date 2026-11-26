import type { DB } from '../db.ts';
import { tx } from '../db.ts';

/**
 * RAPM: koliko poena na 100 napada igrač donosi timu, kad se uračuna sa kim i protiv koga je igrao.
 * Ridge regresija na deonicama iz zapisa poen po poen. Starije deonice vrede manje (poluživot godinu dana).
 * Podešavanja su izabrana proverom na sezonama koje procena nije videla.
 */
export const RAPM_LAMBDA = 1500;
const HALF_LIFE = 365, WINDOW = 3 * 365, MIN_STINTS = 20000, ITER = 200;
/** Procena igrača bez istorije deonica (malo ispod proseka lige). */
export const RAPM_UNKNOWN = -1;

interface Row { t: number; h: number[]; a: number[]; poss: number; m: number }
const dayNo = (d: string) => Date.parse(d.slice(0, 10)) / 864e5;

export function fitRapm(rows: Row[], tNow: number, warm?: Map<number, number>): Map<number, number> {
  const idx = new Map<number, number>();
  for (const r of rows) for (const p of r.h.concat(r.a)) if (!idx.has(p)) idx.set(p, idx.size);
  const n = idx.size + 1; // poslednja kolona: prednost domaćeg terena
  const R = rows.map((r) => ({ h: r.h.map((p) => idx.get(p)!), a: r.a.map((p) => idx.get(p)!), w: r.poss * 0.5 ** ((tNow - r.t) / HALF_LIFE), y: (r.m / r.poss) * 100 }));
  const Ax = (x: Float64Array) => {
    const o = new Float64Array(n);
    for (const r of R) {
      let v = x[n - 1];
      for (const i of r.h) v += x[i];
      for (const i of r.a) v -= x[i];
      v *= r.w;
      for (const i of r.h) o[i] += v;
      for (const i of r.a) o[i] -= v;
      o[n - 1] += v;
    }
    for (let i = 0; i < n - 1; i++) o[i] += RAPM_LAMBDA * x[i];
    o[n - 1] += 1e-3 * x[n - 1];
    return o;
  };
  const b = new Float64Array(n);
  for (const r of R) {
    const v = r.w * r.y;
    for (const i of r.h) b[i] += v;
    for (const i of r.a) b[i] -= v;
    b[n - 1] += v;
  }
  // Konjugovani gradijenti, sa početkom od prethodne procene.
  const x = new Float64Array(n);
  if (warm) for (const [p, i] of idx) x[i] = warm.get(p) ?? 0;
  const x0 = Ax(x), r = b.map((v, i) => v - x0[i]), p = Float64Array.from(r);
  let rs = r.reduce((s, v) => s + v * v, 0);
  for (let it = 0; it < ITER && rs > 1e-8; it++) {
    const Ap = Ax(p);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    const al = rs / pAp;
    let rn = 0;
    for (let i = 0; i < n; i++) { x[i] += al * p[i]; r[i] -= al * Ap[i]; rn += r[i] * r[i]; }
    for (let i = 0; i < n; i++) p[i] = r[i] + (rn / rs) * p[i];
    rs = rn;
  }
  const out = new Map<number, number>();
  for (const [pl, i] of idx) out.set(pl, Math.round(x[i] * 1000) / 1000);
  return out;
}

/** Ponedeljak u nedelji datuma: procena za tu nedelju koristi samo deonice pre tog dana. */
export function weekKey(date: string): string {
  const d = new Date(date.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Procene igrača kroz vreme; izračunate nedelje se čuvaju u bazi. */
export class RapmBook {
  private rows: Row[];
  private cache = new Map<string, Map<number, number> | null>();
  private last: Map<number, number> | undefined;
  private db: DB;
  constructor(db: DB) {
    this.db = db;
    this.rows = (db.prepare('SELECT date, h, a, poss, m FROM stints ORDER BY date').all() as any[])
      .map((s) => ({ t: dayNo(s.date), h: JSON.parse(s.h), a: JSON.parse(s.a), poss: s.poss, m: s.m }));
  }
  get size(): number { return this.rows.length; }

  /** Procene poznate pre datuma `key` (ili null ako još nema dovoljno deonica). */
  at(key: string): Map<number, number> | null {
    if (this.cache.has(key)) return this.cache.get(key)!;
    const t = dayNo(key);
    const rows = this.rows.filter((r) => r.t < t && r.t >= t - WINDOW);
    let res: Map<number, number> | null = null;
    if (rows.length >= MIN_STINTS) {
      const saved = this.db.prepare('SELECT n, ratings FROM rapm WHERE k=?').get(key) as { n: number; ratings: string } | undefined;
      if (saved && saved.n === rows.length) res = new Map(JSON.parse(saved.ratings));
      else {
        res = fitRapm(rows, t, this.last);
        tx(this.db, () => this.db.prepare('INSERT OR REPLACE INTO rapm VALUES(?,?,?)').run(key, rows.length, JSON.stringify([...res!])));
      }
      this.last = res;
    }
    this.cache.set(key, res);
    return res;
  }
}
