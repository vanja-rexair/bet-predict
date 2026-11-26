import { logit, rng, sigmoid } from './metrics.ts';

/**
 * Gradijentno pojačana stabla po XGBoost postupku: gradijent i hesijan drugog reda,
 * L2 regularizacija, histogramska podela, poduzorkovanje redova i kolona,
 * i naučen smer za vrednosti koje nedostaju.
 */
export interface GbdtParams {
  objective: 'logistic' | 'squared';
  rounds: number; depth: number; lr: number; lambda: number; gamma: number;
  minChild: number; subsample: number; colsample: number; bins: number; seed: number;
}
export const DEFAULTS: GbdtParams = {
  objective: 'logistic', rounds: 260, depth: 3, lr: 0.04, lambda: 8, gamma: 0, minChild: 12, subsample: 0.7, colsample: 0.5, bins: 48, seed: 7,
};

/** Ravno zapisano stablo; feat = -1 je list. Nedostajuća vrednost ide levo ako je missLeft. */
interface Tree { feat: number[]; thr: number[]; missLeft: number[]; left: number[]; right: number[]; val: number[] }
export interface Gbdt { base: number; objective: GbdtParams['objective']; trees: Tree[] }

export function trainGbdt(X: Float64Array[], y: Float64Array, w: Float64Array, over: Partial<GbdtParams> = {}): Gbdt {
  const P = { ...DEFAULTS, ...over };
  const n = X.length, m = X[0].length, rand = rng(P.seed);
  const isLog = P.objective === 'logistic';

  // Kvantilne granice; bin 0 je rezervisan za vrednosti koje nedostaju.
  const cuts: number[][] = [];
  const binned: Uint8Array[] = [];
  for (let f = 0; f < m; f++) {
    const vals: number[] = [];
    for (let i = 0; i < n; i++) if (!Number.isNaN(X[i][f])) vals.push(X[i][f]);
    const sorted = Float64Array.from(vals).sort();
    const c: number[] = [];
    for (let b = 1; b < P.bins; b++) {
      const v = sorted[Math.floor((b / P.bins) * sorted.length)];
      if (v !== undefined && (c.length === 0 || v > c[c.length - 1])) c.push(v);
    }
    cuts.push(c);
    const col = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = X[i][f];
      if (Number.isNaN(v)) continue;
      let lo = 0, hi = c.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (v < c[mid]) hi = mid; else lo = mid + 1;
      }
      col[i] = lo + 1; // bin b znači cuts[b-2] <= v < cuts[b-1]
    }
    binned.push(col);
  }

  let sw = 0, swy = 0;
  for (let i = 0; i < n; i++) { sw += w[i]; swy += w[i] * y[i]; }
  const base = isLog ? logit(swy / sw) : swy / sw;
  const F = new Float64Array(n).fill(base);
  const g = new Float64Array(n), h = new Float64Array(n);
  const trees: Tree[] = [];
  const nb = P.bins + 1;
  const hg = new Float64Array(nb), hh = new Float64Array(nb);

  for (let t = 0; t < P.rounds; t++) {
    const rows: number[] = [];
    for (let i = 0; i < n; i++) {
      if (isLog) {
        const p = sigmoid(F[i]);
        g[i] = w[i] * (p - y[i]);
        h[i] = w[i] * Math.max(p * (1 - p), 1e-6);
      } else {
        g[i] = w[i] * (F[i] - y[i]);
        h[i] = w[i];
      }
      if (rand() < P.subsample) rows.push(i);
    }
    let feats = Array.from({ length: m }, (_, f) => f).filter(() => rand() < P.colsample);
    if (!feats.length) feats = [Math.floor(rand() * m)];

    const tree: Tree = { feat: [], thr: [], missLeft: [], left: [], right: [], val: [] };
    const build = (idx: number[], depth: number): number => {
      let G = 0, H = 0;
      for (const i of idx) { G += g[i]; H += h[i]; }
      const id = tree.feat.length;
      tree.feat.push(-1); tree.thr.push(0); tree.missLeft.push(1); tree.left.push(-1); tree.right.push(-1);
      tree.val.push((-G / (H + P.lambda)) * P.lr);
      if (depth >= P.depth || H < 2 * P.minChild) return id;
      const parent = (G * G) / (H + P.lambda);
      let best = P.gamma + 1e-9, bf = -1, bb = 0, bm = 1;
      for (const f of feats) {
        hg.fill(0); hh.fill(0);
        const col = binned[f];
        for (let k = 0; k < idx.length; k++) {
          const i = idx[k], b = col[i];
          hg[b] += g[i]; hh[b] += h[i];
        }
        const mg = hg[0], mh = hh[0];
        let gl = 0, hl = 0;
        for (let b = 1; b <= cuts[f].length; b++) {
          gl += hg[b]; hl += hh[b];
          // Vrednosti koje nedostaju probaju se levo i (ako ih ima) desno.
          for (let miss = mh > 0 ? 0 : 1; miss < 2; miss++) {
            const gL = miss ? gl + mg : gl, hL = miss ? hl + mh : hl;
            const gR = G - gL, hR = H - hL;
            if (hL < P.minChild || hR < P.minChild) continue;
            const gain = (gL * gL) / (hL + P.lambda) + (gR * gR) / (hR + P.lambda) - parent;
            if (gain > best) { best = gain; bf = f; bb = b; bm = miss; }
          }
        }
      }
      if (bf < 0) return id;
      const L: number[] = [], R: number[] = [];
      const col = binned[bf];
      for (const i of idx) ((col[i] === 0 ? bm === 1 : col[i] <= bb) ? L : R).push(i);
      tree.feat[id] = bf;
      tree.thr[id] = cuts[bf][bb - 1];
      tree.missLeft[id] = bm;
      tree.left[id] = build(L, depth + 1);
      tree.right[id] = build(R, depth + 1);
      return id;
    };
    build(rows, 0);
    trees.push(tree);
    for (let i = 0; i < n; i++) F[i] += treeValue(tree, X[i]);
  }
  return { base, objective: P.objective, trees };
}

function next(t: Tree, id: number, x: ArrayLike<number>): number {
  const v = x[t.feat[id]];
  return (Number.isNaN(v) ? t.missLeft[id] === 1 : v < t.thr[id]) ? t.left[id] : t.right[id];
}
function treeValue(t: Tree, x: ArrayLike<number>): number {
  let id = 0;
  while (t.feat[id] >= 0) id = next(t, id, x);
  return t.val[id];
}

/** Sirovi izlaz: logit (logistic) ili vrednost (squared). */
export function predictRaw(model: Gbdt, x: ArrayLike<number>): number {
  let s = model.base;
  for (const t of model.trees) s += treeValue(t, x);
  return s;
}

/** Doprinos svake karakteristike duž putanje kroz stabla (Saabas). */
export function contributions(model: Gbdt, x: ArrayLike<number>, m: number): Float64Array {
  const c = new Float64Array(m);
  for (const t of model.trees) {
    let id = 0;
    while (t.feat[id] >= 0) {
      const nx = next(t, id, x);
      c[t.feat[id]] += t.val[nx] - t.val[id];
      id = nx;
    }
  }
  return c;
}

export function splitCounts(model: Gbdt, m: number): number[] {
  const c = new Array(m).fill(0);
  for (const t of model.trees) for (const f of t.feat) if (f >= 0) c[f]++;
  return c;
}
