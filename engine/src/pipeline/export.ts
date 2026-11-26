import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db.ts';
import { PUBLIC_DIR, addDays, currentSeason, etDate } from '../config.ts';
import { advise, flat } from '../market.ts';
import { TEAMS } from '../teams.ts';
import type { League } from '../model/features.ts';
import type { Advice, GameEvent, GameView, HistoryRow, Miss, RecentGame, Stats, TeamRow } from '../types.ts';
import { record, type BacktestFile } from './train.ts';

type Stored = Omit<GameView, 'events'> & { pre?: unknown };

/** Upis preko privremenog fajla da aplikacija nikad ne pročita polovičan JSON. */
function write(name: string, data: unknown): void {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  const f = path.join(PUBLIC_DIR, name);
  fs.writeFileSync(f + '.tmp', JSON.stringify(data));
  fs.renameSync(f + '.tmp', f);
}

/** Mečevi zapisani pre uvođenja preporuke dobijaju je po istom pravilu iz podataka pre početka. */
const adviceOf = (s: Stored): Advice => s.advice ?? advise(s.pHome, s.odds ? { home: s.odds.home, away: s.odds.away } : null);
const adviceWon = (s: Stored, a: Advice) => (a.side === 'home') === (s.result!.hs > s.result!.as);

export function exportAll(db: DB, bt: BacktestFile, lg: League, live: Stored[]): void {
  const generatedAt = new Date().toISOString();
  const today = etDate(), cur = currentSeason();
  const events = db.prepare('SELECT id, game_id AS gameId, ts, type, importance, title, text FROM events ORDER BY id DESC LIMIT 3000').all() as unknown as GameEvent[];
  const byGame = new Map<number, GameEvent[]>();
  for (const e of events) byGame.set(e.gameId, [...(byGame.get(e.gameId) ?? []), e]);

  const games: GameView[] = live.filter((s) => s.date >= addDays(today, -1)).map((s) => {
    const { pre: _pre, ...v } = s;
    return { ...v, advice: adviceOf(s), events: (byGame.get(s.id) ?? []).slice(0, 40) };
  }).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id - b.id));
  write('events.json', { generatedAt, events: events.slice(0, 80) });

  // Pravi zapis uspešnosti: samo predikcije zaključane pre početka meča.
  const done = live.filter((s) => s.locked && s.result);
  const y = done.map((s) => (s.result!.hs > s.result!.as ? 1 : 0));
  const liveRec = record('Uživo', done.map((s) => s.pHome), y,
    done.flatMap((s, i) => (s.odds ? [{ p: s.odds.implied, y: y[i] }] : [])));
  const bets = done.filter((s) => s.value);
  const won = bets.filter((s) => (s.value!.side === 'home') === (s.result!.hs > s.result!.as));
  const clv = done.filter((s) => s.clv !== null);
  const roi = bets.length ? (won.reduce((s, b) => s + b.value!.odds, 0) - bets.length) / bets.length : 0;
  const avgClv = clv.length ? clv.reduce((s, c) => s + c.clv!, 0) / clv.length : null;
  const betProven = bets.length >= 200 && roi > 0 && (avgClv ?? 0) > 0;
  const stats: Stats = {
    ...bt.stats, generatedAt, live: { ...liveRec, flat: flat(done.map((s) => ({ hit: s.result!.hit, odds: s.closeOddsPick }))) }, betProven,
    liveHighlight: ((l) => {
      const h = l.filter((s) => s.result!.hit), sum = (q: Stored[]) => q.reduce((t, s) => t + s.closeOddsPick!, 0);
      return { n: l.length, hit: h.length, pct: l.length ? h.length / l.length : 0, odds: l.length ? sum(l) / l.length : 0, roi: l.length ? sum(h) / l.length - 1 : 0 };
    })(done.filter((s) => s.highlight && s.closeOddsPick)),
    liveValue: { n: bets.length, won: won.length, roi, clv: avgClv, clvN: clv.length },
    liveAdvice: ((l) => {
      const play = l.filter((s) => s.a.play && s.a.odds), skip = l.filter((s) => !s.a.play);
      const w = play.filter((s) => adviceWon(s, s.a)), sum = (q: typeof l) => q.reduce((t, s) => t + s.a.odds!, 0);
      return {
        play: { n: play.length, hit: w.length, pct: play.length ? w.length / play.length : 0, odds: play.length ? sum(play) / play.length : 0, roi: play.length ? sum(w) / play.length - 1 : 0 },
        skip: { n: skip.length, pickHit: skip.filter((s) => s.result!.hit).length },
      };
    })(done.map((s) => ({ ...s, a: adviceOf(s) }))),
  };
  write('today.json', { generatedAt, today, games, betProven });
  write('stats.json', stats);

  // Uživo zapis ima prednost nad simulacijom za isti meč.
  const hist = new Map<number, HistoryRow>(bt.history.map((h) => [h.id, h]));
  for (const s of done) {
    if (s.season !== cur) continue;
    hist.set(s.id, { id: s.id, date: s.date, home: s.home.abbr, away: s.away.abbr, p: s.pHome, pick: s.pick, hs: s.result!.hs, as: s.result!.as,
      hit: s.result!.hit, src: 'live', odds: s.closeOddsPick });
  }
  write('history.json', { generatedAt, rows: [...hist.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)) });

  const miss = new Map<number, Miss>(bt.misses.map((m) => [m.id, m]));
  for (const s of done) {
    miss.delete(s.id);
    if (s.postmortem) miss.set(s.id, { id: s.id, date: s.date, home: s.home.abbr, away: s.away.abbr, hs: s.result!.hs, as: s.result!.as,
      pick: s.pick === 'home' ? s.home.abbr : s.away.abbr, p: s.confidence, src: 'live', pm: s.postmortem });
  }
  write('misses.json', { generatedAt, rows: [...miss.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)).slice(0, 150) });

  // Poslednjih 7 dana: boja kartice se određuje prema prvoj prognozi.
  const from = addDays(today, -7);
  const byAbbr = new Map([...TEAMS.values()].map((t) => [t.abbr, { id: t.id, abbr: t.abbr, name: t.name }]));
  const startOf = new Map((db.prepare('SELECT id, start FROM games WHERE date>=?').all(from) as { id: number; start: string }[]).map((g) => [g.id, g.start]));
  const recent = new Map<number, RecentGame>();
  for (const h of bt.history) {
    if (h.date < from) continue;
    recent.set(h.id, { id: h.id, date: h.date, start: startOf.get(h.id) ?? h.date, home: byAbbr.get(h.home)!, away: byAbbr.get(h.away)!, hs: h.hs, as: h.as, src: 'test',
      initial: { p: h.p, pick: h.pick, ts: null }, final: null, hit: h.hit, postmortem: miss.get(h.id)?.pm ?? null, odds: h.odds });
  }
  for (const s of done) {
    if (s.date < from) continue;
    const init = s.initial ?? { p: s.pHome, pick: s.pick, ts: s.created };
    const r = s.result!;
    recent.set(s.id, { id: s.id, date: s.date, start: s.start, home: s.home, away: s.away, hs: r.hs, as: r.as, src: 'live',
      initial: init, final: { p: s.pHome, pick: s.pick }, hit: (r.hs > r.as) === (init.pick === 'home'), postmortem: s.postmortem, odds: s.odds ? s.odds[init.pick] : null, advice: adviceOf(s) });
  }
  write('recent.json', { generatedAt, rows: [...recent.values()].sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : b.id - a.id)) });

  const wl = new Map<number, { w: number; l: number }>();
  for (const g of db.prepare('SELECT home,away,hs,as_ FROM games WHERE final=1 AND season=? AND stype=2').all(cur) as any[]) {
    for (const [id, won1] of [[g.home, g.hs > g.as_], [g.away, g.as_ > g.hs]] as [number, boolean][]) {
      const r = wl.get(id) ?? { w: 0, l: 0 };
      if (won1) r.w++; else r.l++;
      wl.set(id, r);
    }
  }
  const hits = new Map(bt.teamHits);
  const teams: TeamRow[] = [...TEAMS.values()].map((t) => {
    const s = lg.team(t.id), r = wl.get(t.id) ?? { w: 0, l: 0 }, h = hits.get(t.id) ?? { hit: 0, picks: 0 };
    return { id: t.id, abbr: t.abbr, name: t.name, ...r, elo: lg.elo.get(t.id), off: lg.lgEff + s.off, def: lg.lgEff + s.def, net: s.off - s.def, pace: s.pace,
      efg: s.efg, tov: s.tov, orb: s.orb, ftr: s.ftr, ...h };
  }).sort((a, b) => b.net - a.net);
  write('teams.json', { generatedAt, rows: teams });
}
