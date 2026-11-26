import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db.ts';
import { setMeta, tx } from '../db.ts';
import { DATA_DIR, FIRST_BACKTEST_SEASON, MODEL_VERSION, currentSeason } from '../config.ts';
import { noVig, ev, isHighlight, kelly } from '../market.ts';
import { evaluate, sigmoid } from '../ml/metrics.ts';
import { buildHistory, type League, type Row } from '../model/features.ts';
import { BASE_NAMES, applyStack, importance, influence, predictBase, trainBase, trainStack, type BaseModels, type BasePred, type Stack, type StackRow } from '../model/ensemble.ts';
import { Gate, Lessons, shift } from '../model/lessons.ts';
import { postmortem } from '../model/postmortem.ts';
import { team } from '../teams.ts';
import type { HistoryRow, Miss, RecordRow, Stats } from '../types.ts';

const OOF_START = FIRST_BACKTEST_SEASON - 1; // jedna sezona za učenje slaganja pre prvog izveštaja
export const MODEL_PATH = path.join(DATA_DIR, 'model.json');
export const BACKTEST_PATH = path.join(DATA_DIR, 'backtest.json');

export interface ModelFile {
  version: number; trainedAt: string; trainedOn: number; base: BaseModels; stack: Stack | null;
  seg: [string, any][]; teams: [number, any][]; segGate: boolean; teamGate: boolean;
}
export interface BtRow { row: Row; stacked: number; final: number; mkt: number | null; pred: BasePred }
export interface BacktestFile {
  stats: Omit<Stats, 'live' | 'liveValue' | 'generatedAt' | 'betProven' | 'liveHighlight'>; history: HistoryRow[]; misses: Miss[]; teamHits: [number, { hit: number; picks: number }][];
}

const blockOf = (r: Row) => `${r.g.season}-${r.g.date.slice(0, 7)}`;
const pickHit = (p: number, y: number) => (p >= 0.5) === (y === 1);

export function record(label: string, p: number[], y: number[], mk: { p: number; y: number }[]): RecordRow {
  const e = evaluate(p, y);
  const hit = Math.round(e.acc * e.n);
  return {
    label, total: e.n, hit, miss: e.n - hit, pct: e.acc, logLoss: e.logLoss, brier: e.brier,
    market: mk.length ? evaluate(mk.map((m) => m.p), mk.map((m) => m.y)).acc : null,
  };
}

/** Predikcije osnovnih modela za svaki mesec, trenirane samo na ranijim mečevima. */
function outOfFold(db: DB, rows: Row[]): Map<number, BasePred> {
  const out = new Map<number, BasePred>();
  const blocks = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.g.season < OOF_START) continue;
    const k = blockOf(r);
    let b = blocks.get(k);
    if (!b) blocks.set(k, (b = []));
    b.push(r);
  }
  const lastKey = [...blocks.keys()].pop();
  const ins = db.prepare('INSERT OR REPLACE INTO oof(game_id,version,block,base,margin,total) VALUES(?,?,?,?,?,?)');
  for (const [key, list] of blocks) {
    const cached = db.prepare('SELECT games FROM oof_block WHERE block=? AND version=?').get(key, MODEL_VERSION) as { games: number } | undefined;
    if (cached && cached.games === list.length && key !== lastKey) {
      for (const r of db.prepare('SELECT * FROM oof WHERE block=? AND version=?').iterate(key, MODEL_VERSION) as Iterable<any>) {
        out.set(r.game_id, { logits: JSON.parse(r.base), margin: r.margin, total: r.total });
      }
      continue;
    }
    const start = list[0].g.date;
    const prior = rows.filter((r) => r.g.date < start);
    if (prior.length < 500) continue; // premalo istorije za trening
    const models = trainBase(prior, start);
    tx(db, () => {
      for (const r of list) {
        const p = predictBase(models, r.x);
        out.set(r.g.id, p);
        ins.run(r.g.id, MODEL_VERSION, key, JSON.stringify(p.logits), p.margin, p.total);
      }
      db.prepare('INSERT OR REPLACE INTO oof_block VALUES(?,?,?)').run(key, MODEL_VERSION, list.length);
    });
    console.log(`  blok ${key}: ${list.length} mečeva`);
  }
  return out;
}

export interface TrainResult { model: ModelFile; league: League; backtest: BacktestFile }

export function train(db: DB): TrainResult {
  const { rows, league } = buildHistory(db);
  const names = new Map((db.prepare('SELECT pid,name FROM players').all() as { pid: number; name: string }[]).map((r) => [r.pid, r.name]));
  const oddsRows = db.prepare('SELECT * FROM odds').all() as any[];
  const odds = new Map<number, any>(oddsRows.map((o) => [o.game_id, o]));
  const oof = outOfFold(db, rows);

  // Slaganje, korekcije i merenje: sve redom kroz vreme, nikad unapred.
  const lessons = new Lessons(), segGate = new Gate(), teamGate = new Gate();
  const bt: BtRow[] = [];
  const past: StackRow[] = [];
  let stack: Stack | null = null, lastBlock = '';
  for (const row of rows) {
    const pred = oof.get(row.g.id);
    if (!pred) continue;
    const key = blockOf(row);
    if (key !== lastBlock) { stack = trainStack(past); lastBlock = key; }
    const o = odds.get(row.g.id);
    const mkt = o ? noVig(o.mlh_close, o.mla_close) : null; // samo za poređenje u izveštaju
    const stacked = applyStack(stack, pred.logits);
    const dSeg = lessons.segment(row.x, stacked), dTeam = lessons.team(row.g.home, row.g.away);
    const final = shift(stacked, (segGate.active ? dSeg : 0) + (teamGate.active ? dTeam : 0));
    segGate.add(stacked, shift(stacked, dSeg), row.y);
    teamGate.add(stacked, shift(stacked, dTeam), row.y);
    lessons.learn(row.x, stacked, row.y, row.g.home, row.g.away);
    bt.push({ row, stacked, final, mkt, pred });
    past.push({ logits: pred.logits, y: row.y, date: row.g.date });
  }
  stack = trainStack(past);

  const asOf = rows[rows.length - 1].g.date;
  const base = trainBase(rows, asOf);
  const trainedAt = new Date().toISOString();
  const model: ModelFile = {
    version: MODEL_VERSION, trainedAt, trainedOn: rows.length, base, stack,
    seg: [...lessons.seg], teams: [...lessons.teams], segGate: segGate.active, teamGate: teamGate.active,
  };
  const wSum = stack ? stack.coef.reduce((s, v) => s + v, 0) : 1;
  const how = { ...influence(base, rows), weights: BASE_NAMES.map((name, i) => ({ name, weight: stack ? stack.coef[i] / wSum : 1 / BASE_NAMES.length })) };
  const backtest = report(how, bt.filter((b) => b.row.g.season >= FIRST_BACKTEST_SEASON), odds, names, lessons, segGate, teamGate, base, trainedAt, rows.length);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MODEL_PATH, JSON.stringify(model));
  fs.writeFileSync(BACKTEST_PATH, JSON.stringify(backtest));
  setMeta(db, 'trainedAt', trainedAt);
  setMeta(db, 'trainedTotal', String((db.prepare('SELECT COUNT(*) n FROM games WHERE final=1').get() as { n: number }).n));
  const o = backtest.stats.overall;
  console.log(`Backtest ${o.total} mečeva: ${(o.pct * 100).toFixed(2)}% pogođeno, log loss ${o.logLoss.toFixed(4)}, tržište ${((o.market ?? 0) * 100).toFixed(2)}%`);
  return { model, league, backtest };
}

function report(how: Stats['how'], bt: BtRow[], odds: Map<number, any>, names: Map<number, string>, lessons: Lessons, segGate: Gate, teamGate: Gate,
  base: BaseModels, trainedAt: string, trainedOn: number): BacktestFile {
  const cur = currentSeason();
  const rec = (label: string, list: BtRow[]) => record(label, list.map((b) => b.final), list.map((b) => b.row.y),
    list.filter((b) => b.mkt !== null).map((b) => ({ p: b.mkt!, y: b.row.y })));
  const seasons: RecordRow[] = [];
  for (let s = FIRST_BACKTEST_SEASON; s <= cur; s++) {
    const l = bt.filter((b) => b.row.g.season === s);
    if (l.length) seasons.push(rec(`${s - 1}/${String(s).slice(2)}`, l));
  }
  const y = bt.map((b) => b.row.y);
  const models = BASE_NAMES.map((name, i) => ({ name, ...pickM(evaluate(bt.map((b) => sigmoid(b.pred.logits[i])), y)) }));
  models.push({ name: 'Konačan model (bez kvota)', ...pickM(evaluate(bt.map((b) => b.final), y)) });
  const wm = bt.filter((b) => b.mkt !== null);
  models.push({ name: 'Kladionica, samo za poređenje', ...pickM(evaluate(wm.map((b) => b.mkt!), wm.map((b) => b.row.y))) });

  const edges = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 1.0001];
  const buckets = edges.slice(0, -1).map((lo, i) => {
    const l = bt.filter((b) => { const c = Math.max(b.final, 1 - b.final); return c >= lo && c < edges[i + 1]; });
    const hit = l.filter((b) => pickHit(b.final, b.row.y)).length;
    return { label: i === edges.length - 2 ? '90%+' : `${Math.round(lo * 100)}-${Math.round(edges[i + 1] * 100)}%`, n: l.length, hit, pct: l.length ? hit / l.length : 0,
      expected: l.length ? l.reduce((s, b) => s + Math.max(b.final, 1 - b.final), 0) / l.length : 0 };
  });
  const calibration = Array.from({ length: 10 }, (_, i) => {
    const l = bt.filter((b) => b.final >= i / 10 && b.final < (i + 1) / 10);
    return { p: l.length ? l.reduce((s, b) => s + b.final, 0) / l.length : 0, actual: l.length ? l.reduce((s, b) => s + b.row.y, 0) / l.length : 0, n: l.length };
  }).filter((c) => c.n >= 20);
  const monthMap = new Map<string, { total: number; hit: number }>();
  for (const b of bt.filter((q) => q.row.g.season >= cur - 1)) {
    const m = monthMap.get(b.row.g.date.slice(0, 7)) ?? { total: 0, hit: 0 };
    m.total++;
    if (pickHit(b.final, b.row.y)) m.hit++;
    monthMap.set(b.row.g.date.slice(0, 7), m);
  }

  // Analiza svih promašaja.
  const cats = new Map<string, { n: number; variance: number }>();
  const misses: Miss[] = [];
  let variance = 0;
  for (const b of bt) {
    if (pickHit(b.final, b.row.y)) continue;
    const g = b.row.g, ph = b.final >= 0.5, h = team(g.home), a = team(g.away);
    const pm = postmortem({ pickHome: ph, hs: g.hs, as: g.as_, pre: b.row.pre, hb: b.row.hb, ab: b.row.ab, ps: b.row.ps, homeId: g.home, awayId: g.away,
      pickName: ph ? h.name : a.name, name: (id) => names.get(id) ?? String(id) });
    const c = cats.get(pm.category) ?? { n: 0, variance: 0 };
    c.n++;
    if (pm.nature === 'varijansa') { c.variance++; variance++; }
    cats.set(pm.category, c);
    if (g.season >= cur) misses.push({ id: g.id, date: g.date, home: h.abbr, away: a.abbr, hs: g.hs, as: g.as_, pick: ph ? h.abbr : a.abbr, p: Math.max(b.final, 1 - b.final), src: 'test', pm });
  }
  const missTotal = [...cats.values()].reduce((s, c) => s + c.n, 0);

  // Simulacija ravnih uloga na završnu kvotu kad model vidi bar 5% vrednosti.
  let vn = 0, vw = 0, profit = 0;
  for (const b of bt) {
    const o = odds.get(b.row.g.id);
    if (!o || b.mkt === null) continue;
    for (const side of [1, 0]) {
      const p = side ? b.final : 1 - b.final, od = side ? o.mlh_close : o.mla_close;
      if (p >= 0.4 && ev(p, od) >= 0.05) {
        vn++;
        if (b.row.y === side) { vw++; profit += od - 1; } else profit -= 1;
      }
    }
  }
  // Predloženi ulozi: koliko bi donelo svakih 100 dinara uloženih po Kelly predlogu.
  let kn = 0, kh = 0, kIn = 0, kOut = 0;
  for (const b of bt) {
    const o = odds.get(b.row.g.id);
    if (!o || b.mkt === null) continue;
    const od = b.final >= 0.5 ? o.mlh_close : o.mla_close, stake = kelly(Math.max(b.final, 1 - b.final), od);
    if (stake <= 0) continue;
    kn++; kIn += stake;
    if (pickHit(b.final, b.row.y)) { kh++; kOut += stake * od; }
  }
  const staking = { n: kn, hit: kh, pct: kn ? kh / kn : 0, roi: kIn ? kOut / kIn - 1 : 0 };

  // Istaknuti izbori: siguran i dobra kvota.
  let hn = 0, hh = 0, hg = 0, ho = 0;
  for (const b of bt) {
    const o = odds.get(b.row.g.id);
    if (!o || b.mkt === null) continue;
    const od = b.final >= 0.5 ? o.mlh_close : o.mla_close;
    if (!isHighlight(Math.max(b.final, 1 - b.final), od)) continue;
    hn++; ho += od;
    if (pickHit(b.final, b.row.y)) { hh++; hg += od - 1; } else hg -= 1;
  }
  const highlight = { n: hn, hit: hh, pct: hn ? hh / hn : 0, odds: hn ? ho / hn : 0, roi: hn ? hg / hn : 0 };

  // Isti ulog na svaki izbor iznad zadate sigurnosti: pokazuje da visok procenat pogodaka nije isto što i plus.
  const byConfidence = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9].map((min) => {
    let n = 0, hit = 0, gain = 0, sum = 0;
    for (const b of bt) {
      const o = odds.get(b.row.g.id);
      if (!o || b.mkt === null || Math.max(b.final, 1 - b.final) < min) continue;
      const od = b.final >= 0.5 ? o.mlh_close : o.mla_close;
      n++; sum += od;
      if (pickHit(b.final, b.row.y)) { hit++; gain += od - 1; } else gain -= 1;
    }
    return { min, n, hit, pct: n ? hit / n : 0, odds: n ? sum / n : 0, roi: n ? gain / n : 0 };
  });
  const tot = bt.filter((b) => Number.isFinite(odds.get(b.row.g.id)?.total_close));
  const mae = (f: (b: BtRow) => number) => (tot.length ? tot.reduce((s, b) => s + Math.abs(f(b) - b.row.total), 0) / tot.length : 0);

  const thisSeason = bt.filter((b) => b.row.g.season === cur);
  const teamHits = new Map<number, { hit: number; picks: number }>();
  for (const b of thisSeason) for (const id of [b.row.g.home, b.row.g.away]) {
    const t = teamHits.get(id) ?? { hit: 0, picks: 0 };
    t.picks++;
    if (pickHit(b.final, b.row.y)) t.hit++;
    teamHits.set(id, t);
  }
  return {
    stats: {
      version: MODEL_VERSION, trainedAt, trainedOn, season: rec(`Sezona ${cur - 1}/${String(cur).slice(2)}`, thisSeason), overall: rec('Ukupno', bt), seasons, models,
      buckets, calibration, months: [...monthMap].map(([month, m]) => ({ month, ...m, pct: m.hit / m.total })), lessons: lessons.list(),
      lessonGate: segGate.view(), teamGate: teamGate.view(),
      missCategories: [...cats].map(([category, c]) => ({ category, n: c.n, share: c.n / missTotal, variance: c.variance / c.n })).sort((a, b) => b.n - a.n),
      missTotal, varianceShare: missTotal ? variance / missTotal : 0, value: { n: vn, won: vw, roi: vn ? profit / vn : 0 }, byConfidence, highlight, staking, how, importance: importance(base),
      totals: { mae: mae((b) => b.pred.total), marketMae: tot.length ? mae((b) => odds.get(b.row.g.id).total_close) : null, n: tot.length },
    },
    history: thisSeason.map((b) => {
      const g = b.row.g, o = odds.get(g.id), ph = b.final >= 0.5;
      return { id: g.id, date: g.date, home: team(g.home).abbr, away: team(g.away).abbr, p: b.final, pick: ph ? 'home' as const : 'away' as const, hs: g.hs, as: g.as_,
        hit: pickHit(b.final, b.row.y), src: 'test' as const, odds: o ? (ph ? o.mlh_close : o.mla_close) : null };
    }).reverse(),
    misses: misses.reverse(), teamHits: [...teamHits],
  };
}
const pickM = (m: { acc: number; logLoss: number; brier: number }) => ({ acc: m.acc, logLoss: m.logLoss, brier: m.brier });
