import { sigmoid } from './metrics.ts';

/** Linearni modeli sa L2 kaznom; karakteristike se standardizuju, a nedostajuće zamenjuju prosekom. */
export interface Linear { kind: 'logistic' | 'ridge'; mean: number[]; sd: number[]; coef: number[]; intercept: number }

/** Rešava Ax=b za simetričnu pozitivno definitnu matricu (Choleski). */
export function solveSpd(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  const L = A.map((r) => Float64Array.from(r));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = L[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j][j];
    }
  }
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * x[k];
    x[i] = s / L[i][i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/**
 * `prior` (u standardizovanoj skali isključen) omogućava da kazna vuče ka zadatim koeficijentima,
 * što se koristi kod slaganja modela sa malo podataka.
 */
export function trainLinear(
  X: ArrayLike<number>[], y: ArrayLike<number>, w: ArrayLike<number>, kind: Linear['kind'], l2: number,
  opts: { standardize?: boolean; prior?: number[] } = {},
): Linear {
  const { standardize = true, prior } = opts;
  const n = X.length, m = X[0].length;
  const mean = new Array(m).fill(0), sd = new Array(m).fill(1);
  if (standardize) {
    for (let f = 0; f < m; f++) {
      let s = 0, c = 0;
      for (let i = 0; i < n; i++) if (!Number.isNaN(X[i][f])) { s += X[i][f]; c++; }
      mean[f] = c ? s / c : 0;
      let v = 0;
      for (let i = 0; i < n; i++) if (!Number.isNaN(X[i][f])) v += (X[i][f] - mean[f]) ** 2;
      // Gotovo konstantna karakteristika ne nosi informaciju; bez ove zaštite bi se delilo skoro nulom.
      const dev = c ? Math.sqrt(v / c) : 0;
      sd[f] = dev > 1e-6 * Math.max(1, Math.abs(mean[f])) ? dev : Infinity;
    }
  }
  const Z = X.map((r) => {
    const z = new Float64Array(m + 1);
    for (let f = 0; f < m; f++) z[f] = Number.isNaN(r[f]) ? 0 : (r[f] - mean[f]) / sd[f];
    z[m] = 1;
    return z;
  });
  const beta = new Float64Array(m + 1);
  if (prior) for (let f = 0; f < m; f++) beta[f] = prior[f];
  const iters = kind === 'logistic' ? 12 : 1;
  for (let it = 0; it < iters; it++) {
    const A = Array.from({ length: m + 1 }, () => new Float64Array(m + 1));
    const b = new Float64Array(m + 1);
    for (let i = 0; i < n; i++) {
      const z = Z[i];
      let e = 0;
      for (let f = 0; f <= m; f++) e += beta[f] * z[f];
      const p = kind === 'logistic' ? sigmoid(e) : e;
      const wh = w[i] * (kind === 'logistic' ? Math.max(p * (1 - p), 1e-6) : 1);
      const r = w[i] * (y[i] - p);
      for (let a = 0; a <= m; a++) {
        const za = z[a];
        if (za === 0) continue;
        b[a] += r * za;
        const row = A[a], wz = wh * za;
        for (let c = 0; c <= a; c++) row[c] += wz * z[c];
      }
    }
    for (let a = 0; a <= m; a++) {
      for (let c = 0; c < a; c++) A[c][a] = A[a][c];
      if (a < m) {
        A[a][a] += l2;
        b[a] -= l2 * (beta[a] - (prior?.[a] ?? 0));
      } else A[a][a] += 1e-9;
    }
    const d = solveSpd(A, b);
    let mx = 0;
    for (let f = 0; f <= m; f++) { beta[f] += d[f]; mx = Math.max(mx, Math.abs(d[f])); }
    if (mx < 1e-7) break;
  }
  return { kind, mean, sd, coef: Array.from(beta.slice(0, m)), intercept: beta[m] };
}

/** Sirovi izlaz: logit (logistic) ili vrednost (ridge). */
export function linearRaw(m: Linear, x: ArrayLike<number>): number {
  let s = m.intercept;
  for (let f = 0; f < m.coef.length; f++) if (!Number.isNaN(x[f])) s += m.coef[f] * Math.max(-10, Math.min(10, (x[f] - m.mean[f]) / (m.sd[f] ?? Infinity)));
  return s;
}
