export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
export const logit = (p: number) => {
  const q = clamp(p, 1e-6, 1 - 1e-6);
  return Math.log(q / (1 - q));
};
/** Kumulativna normalna raspodela (Abramowitz-Stegun). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export interface Metrics { n: number; acc: number; logLoss: number; brier: number }
export function evaluate(p: ArrayLike<number>, y: ArrayLike<number>): Metrics {
  let ll = 0, br = 0, hit = 0;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const q = clamp(p[i], 1e-6, 1 - 1e-6);
    ll -= y[i] ? Math.log(q) : Math.log(1 - q);
    br += (q - y[i]) ** 2;
    if (q >= 0.5 === y[i] >= 0.5) hit++;
  }
  return n ? { n, acc: hit / n, logLoss: ll / n, brier: br / n } : { n: 0, acc: 0, logLoss: 0, brier: 0 };
}

/** Deterministički generator (mulberry32) da trening bude ponovljiv. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
