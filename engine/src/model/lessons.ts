import { clamp, logit, sigmoid } from '../ml/metrics.ts';
import { FEATURES } from './features.ts';
import type { Lesson } from '../types.ts';

/**
 * Učenje iz grešaka. Posle svakog meča poredimo predviđenu i stvarnu učestalost po situacijama
 * i po timovima. Korekcija se uvodi samo ako je odstupanje statistički značajno, a ceo
 * mehanizam ostaje uključen samo dok na ranijim, već odigranim mečevima zaista smanjuje log loss.
 */
const IX = Object.fromEntries(FEATURES.map(([n], i) => [n, i])) as Record<string, number>;

export const SEGMENTS: { key: string; label: string; test: (x: Float64Array, p: number) => boolean }[] = [
  { key: 'fav_b2b', label: 'Favorit igra drugi meč u dva dana', test: (x, p) => x[IX[p >= 0.5 ? 'b2bH' : 'b2bA']] === 1 },
  { key: 'dog_b2b', label: 'Autsajder igra drugi meč u dva dana', test: (x, p) => x[IX[p >= 0.5 ? 'b2bA' : 'b2bH']] === 1 },
  { key: 'fav_in4', label: 'Favorit u seriji 3 meča za 4 dana', test: (x, p) => x[IX[p >= 0.5 ? 'in4H' : 'in4A']] === 1 },
  { key: 'fav_away', label: 'Favorit gostuje', test: (_x, p) => p < 0.5 },
  { key: 'fav_big', label: 'Ubedljiv favorit (preko 80%)', test: (_x, p) => Math.max(p, 1 - p) >= 0.8 },
  { key: 'tossup', label: 'Izjednačen meč (ispod 56%)', test: (_x, p) => Math.max(p, 1 - p) < 0.56 },
  { key: 'fav_missing', label: 'Favoritu nedostaju važni igrači', test: (x, p) => x[IX[p >= 0.5 ? 'missH' : 'missA']] > 3 },
  { key: 'dog_missing', label: 'Autsajderu nedostaju važni igrači', test: (x, p) => x[IX[p >= 0.5 ? 'missA' : 'missH']] > 3 },
  { key: 'early', label: 'Početak sezone (prvih 10 mečeva)', test: (x) => x[IX.progress] < 10 },
  { key: 'late', label: 'Kraj regularne sezone', test: (x) => x[IX.progress] >= 60 && x[IX.playoff] === 0 },
  { key: 'playoff', label: 'Plej-of', test: (x) => x[IX.playoff] === 1 },
  { key: 'fav_hot3', label: 'Favorit šutira trojke iznad svog proseka', test: (x, p) => x[IX.luck3] * (p >= 0.5 ? 1 : -1) > 0.04 },
  { key: 'fav_cold3', label: 'Favorit šutira trojke ispod svog proseka', test: (x, p) => x[IX.luck3] * (p >= 0.5 ? 1 : -1) < -0.04 },
  { key: 'fav_form', label: 'Favorit u naletu (razlika forme preko 10 poena)', test: (x, p) => x[IX.form5] * (p >= 0.5 ? 1 : -1) > 10 },
  { key: 'fav_travel', label: 'Favorit prešao mnogo više kilometara', test: (x, p) => x[IX.km7] * (p >= 0.5 ? 1 : -1) > 2 },
  { key: 'altitude', label: 'Domaćin na visini (Denver, Juta)', test: (x) => x[IX.altitude] > 0.9 },
];

const MIN_N = 200, MIN_Z = 2, SHRINK = 300 * 0.22;
interface Acc { n: number; sp: number; sy: number; v: number }

export class Lessons {
  seg = new Map<string, Acc>();
  /** Nedavno odstupanje tima (iz ugla tog tima), sa zaboravljanjem. */
  teams = new Map<number, { r: number; v: number }>();

  private segAdjust(key: string): { adj: number; z: number; a: Acc } {
    const a = this.seg.get(key) ?? { n: 0, sp: 0, sy: 0, v: 0 };
    const z = a.v > 0 ? (a.sy - a.sp) / Math.sqrt(a.v) : 0;
    return { adj: a.n >= MIN_N && Math.abs(z) >= MIN_Z ? (a.sy - a.sp) / (a.v + SHRINK) : 0, z, a };
  }
  /** Korekcija po situacijama, u logitima domaćina. */
  segment(x: Float64Array, p: number): number {
    let s = 0;
    for (const g of SEGMENTS) if (g.test(x, p)) s += this.segAdjust(g.key).adj;
    return clamp(0.5 * s, -0.15, 0.15) * (p >= 0.5 ? 1 : -1);
  }
  /** Korekcija po timovima, u logitima domaćina. */
  team(home: number, away: number): number {
    const b = (id: number) => {
      const t = this.teams.get(id);
      return t ? t.r / (t.v + 14) : 0;
    };
    return clamp(b(home) - b(away), -0.25, 0.25);
  }
  learn(x: Float64Array, p: number, y: number, home: number, away: number): void {
    const pf = Math.max(p, 1 - p), yf = p >= 0.5 ? y : 1 - y;
    for (const g of SEGMENTS) {
      if (!g.test(x, p)) continue;
      const a = this.seg.get(g.key) ?? { n: 0, sp: 0, sy: 0, v: 0 };
      a.n++; a.sp += pf; a.sy += yf; a.v += pf * (1 - pf);
      this.seg.set(g.key, a);
    }
    for (const [id, r] of [[home, y - p], [away, p - y]] as const) {
      const t = this.teams.get(id) ?? { r: 0, v: 0 };
      t.r = t.r * 0.94 + r;
      t.v = t.v * 0.94 + p * (1 - p);
      this.teams.set(id, t);
    }
  }
  list(): Lesson[] {
    return SEGMENTS.map((g) => {
      const { adj, z, a } = this.segAdjust(g.key);
      return { key: g.key, label: g.label, n: a.n, expected: a.n ? a.sp / a.n : 0, actual: a.n ? a.sy / a.n : 0, z, adjust: adj, active: adj !== 0 };
    }).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  }
}

/** Prati da li mehanizam pomaže; aktivan je samo dok mu je dosadašnji učinak pozitivan. */
export class Gate {
  before = 0; after = 0; n = 0;
  get active(): boolean { return this.n >= 600 && this.after < this.before; }
  add(p: number, q: number, y: number): void {
    const ll = (v: number) => -Math.log(clamp(y ? v : 1 - v, 1e-6, 1));
    this.before += ll(p); this.after += ll(q); this.n++;
  }
  view() { return { active: this.active, before: this.n ? this.before / this.n : 0, after: this.n ? this.after / this.n : 0, n: this.n }; }
}
export const shift = (p: number, d: number) => sigmoid(logit(p) + d);
