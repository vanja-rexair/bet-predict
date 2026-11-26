import { trainGbdt, predictRaw, contributions, splitCounts, type Gbdt } from '../ml/gbdt.ts';
import { trainLinear, linearRaw, type Linear } from '../ml/linear.ts';
import { clamp, logit, normCdf, sigmoid } from '../ml/metrics.ts';
import { FEATURES, GROUPS, NF, type Row } from './features.ts';
import { DESCRIBE } from './describe.ts';
import type { ParamInfo } from '../types.ts';

/** Osnovni modeli: logistička regresija, XGBoost-stil stabla, dva modela razlike u poenima i model ukupnog broja poena. */
export interface BaseModels { lr: Linear; gb: Gbdt; gb2: Gbdt; ridge: Linear; gbMargin: Gbdt; total: Gbdt; sdMargin: number; sdTotal: number }
export interface BasePred { logits: number[]; margin: number; total: number }
export const BASE_NAMES = ['Elo', 'Glicko', 'Logistička regresija', 'Gradient boosting', 'Razlika poena'];

const HALF_LIFE_DAYS = 365 * 3.5;

export function trainBase(rows: Row[], asOf: string): BaseModels {
  const X = rows.map((r) => r.x);
  const y = Float64Array.from(rows, (r) => r.y);
  const t0 = Date.parse(asOf);
  // Noviji mečevi vrede više jer se stil igre menja.
  const w = Float64Array.from(rows, (r) => 0.5 ** ((t0 - Date.parse(r.g.date)) / 86400000 / HALF_LIFE_DAYS));
  const m = Float64Array.from(rows, (r) => clamp(r.margin, -30, 30));
  const tot = Float64Array.from(rows, (r) => r.total - r.x[6]); // odstupanje od projekcije tempo x efikasnost
  const lr = trainLinear(X, y, w, 'logistic', 60);
  const ridge = trainLinear(X, m, w, 'ridge', 120);
  const gb = trainGbdt(X, y, w, { seed: 11 });
  const gb2 = trainGbdt(X, y, w, { seed: 29, depth: 4, rounds: 200, lr: 0.03, minChild: 25, colsample: 0.35 });
  const gbMargin = trainGbdt(X, m, w, { objective: 'squared', rounds: 220, minChild: 60, seed: 17 });
  const total = trainGbdt(X, tot, w, { objective: 'squared', rounds: 120, minChild: 80, seed: 23 });
  let sm = 0, st = 0, sw = 0;
  for (let i = 0; i < rows.length; i++) {
    const e = (linearRaw(ridge, X[i]) + predictRaw(gbMargin, X[i])) / 2 - m[i];
    sm += w[i] * e * e;
    st += w[i] * (predictRaw(total, X[i]) - tot[i]) ** 2;
    sw += w[i];
  }
  return { lr, gb, gb2, ridge, gbMargin, total, sdMargin: Math.sqrt(sm / sw), sdTotal: Math.sqrt(st / sw) };
}

export function predictBase(b: BaseModels, x: Float64Array): BasePred {
  const margin = (linearRaw(b.ridge, x) + predictRaw(b.gbMargin, x)) / 2;
  return {
    logits: [x[0], x[1], linearRaw(b.lr, x), (predictRaw(b.gb, x) + predictRaw(b.gb2, x)) / 2, logit(normCdf(margin / b.sdMargin))],
    margin, total: x[6] + predictRaw(b.total, x),
  };
}

/** Objašnjenje: doprinos grupe karakteristika (u logitima), prosek linearnog modela i stabala. */
export function explain(b: BaseModels, x: Float64Array): { group: string; value: number }[] {
  const by = new Map<string, number>();
  contribution(b, x).forEach((v, f) => {
    const g = GROUPS[FEATURES[f][1]];
    by.set(g, (by.get(g) ?? 0) + v);
  });
  return [...by].map(([group, value]) => ({ group, value })).sort((a, z) => Math.abs(z.value) - Math.abs(a.value));
}
function contribution(b: BaseModels, x: Float64Array): Float64Array {
  return contributions(b.gb, x, NF).map((c, f) => (c + (b.lr.coef[f] * (x[f] - b.lr.mean[f])) / (b.lr.sd[f] ?? Infinity)) / 2); // JSON pamti Infinity kao null
}

/** Prosečan uticaj parametara i grupa na prognozu u poslednjim mečevima. */
export function influence(b: BaseModels, rows: Row[]): { games: number; groups: { group: string; share: number }[]; params: ParamInfo[] } {
  const last = rows.slice(-1500);
  const f = new Float64Array(NF), g = new Map<string, number>();
  for (const r of last) {
    contribution(b, r.x).forEach((v, i) => { f[i] += Math.abs(v); });
    for (const e of explain(b, r.x)) g.set(e.group, (g.get(e.group) ?? 0) + Math.abs(e.value));
  }
  const ft = f.reduce((s, v) => s + v, 0) || 1, gt = [...g.values()].reduce((s, v) => s + v, 0) || 1;
  return {
    games: last.length,
    groups: [...g].map(([group, v]) => ({ group, share: v / gt })).sort((a, z) => z.share - a.share),
    params: FEATURES.map(([key, gr], i) => ({ key, label: DESCRIBE[key][0], desc: DESCRIBE[key][1], group: GROUPS[gr], share: f[i] / ft })).sort((a, z) => z.share - a.share),
  };
}

export function importance(b: BaseModels): { group: string; share: number }[] {
  const c = splitCounts(b.gb, NF), tot = c.reduce((s, v) => s + v, 0) || 1;
  const by = new Map<string, number>();
  for (let f = 0; f < NF; f++) by.set(GROUPS[FEATURES[f][1]], (by.get(GROUPS[FEATURES[f][1]]) ?? 0) + c[f] / tot);
  return [...by].map(([group, share]) => ({ group, share })).sort((a, z) => z.share - a.share);
}

/** Slaganje osnovnih modela u jednu verovatnoću. Kvote ovde namerno ne učestvuju. */
export type Stack = Linear;
export interface StackRow { logits: number[]; y: number; date: string }

export function trainStack(rows: StackRow[]): Stack | null {
  if (rows.length < 400) return null;
  const t0 = Date.parse(rows[rows.length - 1].date);
  const w = (r: StackRow) => 0.5 ** ((t0 - Date.parse(r.date)) / 86400000 / (365 * 3));
  return trainLinear(rows.map((r) => r.logits), rows.map((r) => r.y), rows.map(w), 'logistic', 60,
    { standardize: false, prior: rows[0].logits.map(() => 1 / rows[0].logits.length) });
}

export function applyStack(s: Stack | null, logits: number[]): number {
  return sigmoid(s ? linearRaw(s, logits) : logits.reduce((a, b) => a + b, 0) / logits.length);
}
