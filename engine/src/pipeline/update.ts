import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db.ts';
import { getMeta, setMeta, tx } from '../db.ts';
import { MODEL_VERSION, STATE_DIR, addDays, etDate } from '../config.ts';
import { ev, isHighlight, kelly, noVig } from '../market.ts';
import { ingestSummary, injuries, roster, scoreboard, type BoardGame, type Injury } from '../sources/espn.ts';
import { TEAMS, team } from '../teams.ts';
import { buildHistory, type Availability, type League, type Pregame, type TeamBox, type PlayerBox } from '../model/features.ts';
import { BASE_NAMES, applyStack, explain, predictBase } from '../model/ensemble.ts';
import { Lessons, shift } from '../model/lessons.ts';
import { postmortem } from '../model/postmortem.ts';
import { sigmoid } from '../ml/metrics.ts';
import { inPlayProb, remaining } from '../model/inplay.ts';
import { ingestAll } from './ingest.ts';
import { BACKTEST_PATH, MODEL_PATH, train, type BacktestFile, type ModelFile } from './train.ts';
import { exportAll } from './export.ts';
import type { GameView, LiveState, OutPlayer, TeamRef } from '../types.ts';

const DAYS_AHEAD = 2;
const PROB: Record<string, number> = { Out: 0, Suspension: 0, Doubtful: 0.2, Questionable: 0.5, 'Day-To-Day': 0.6, Probable: 0.9 };

/** Stanje koje server drži u memoriji između provera. */
export interface Ctx { league: League | null; games: number; model: ModelFile | null }
export const newCtx = (): Ctx => ({ league: null, games: -1, model: null });

/** Interni zapis; `pre` služi analizi posle meča i ne šalje se aplikaciji. */
type Stored = Omit<GameView, 'events'> & { pre: Pregame };

const ref = (id: number): TeamRef => ({ id, abbr: team(id).abbr, name: team(id).name });
const pct = (v: number) => `${Math.round(v * 100)}%`;
const countFinal = (db: DB) => (db.prepare('SELECT COUNT(*) n FROM games WHERE final=1').get() as { n: number }).n;

export function loadLive(db: DB): Stored[] {
  return (db.prepare('SELECT payload FROM live ORDER BY game_id').all() as { payload: string }[]).map((r) => JSON.parse(r.payload));
}
function saveLive(db: DB, s: Stored): void {
  db.prepare('INSERT INTO live(game_id,created,locked,payload) VALUES(?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET locked=excluded.locked, payload=excluded.payload')
    .run(s.id, s.created, s.locked ? 1 : 0, JSON.stringify(s));
}
function event(db: DB, gameId: number, type: string, importance: number, title: string, text: string): void {
  db.prepare('INSERT INTO events(game_id,ts,type,importance,title,text) VALUES(?,?,?,?,?,?)').run(gameId, new Date().toISOString(), type, importance, title, text);
}

/** Trajni zapis predikcija van baze, da se istorija uspešnosti ne izgubi. */
const STATE_FILE = path.join(STATE_DIR, 'live.json');
function backupState(db: DB): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ live: loadLive(db), events: db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 2000').all() }));
  fs.renameSync(tmp, STATE_FILE);
}
function restoreState(db: DB): void {
  if ((db.prepare('SELECT COUNT(*) n FROM live').get() as { n: number }).n > 0 || !fs.existsSync(STATE_FILE)) return;
  const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as { live: Stored[]; events: any[] };
  tx(db, () => {
    for (const s of j.live) saveLive(db, s);
    const ins = db.prepare('INSERT OR IGNORE INTO events(id,game_id,ts,type,importance,title,text) VALUES(?,?,?,?,?,?,?)');
    for (const e of j.events) ins.run(e.id, e.game_id, e.ts, e.type, e.importance, e.title, e.text);
  });
}

async function rosters(db: DB): Promise<Map<number, number[]>> {
  const cached = getMeta(db, 'rosters');
  if (cached) {
    const c = JSON.parse(cached) as { ts: number; r: [number, number[]][] };
    if (Date.now() - c.ts < 8 * 3600e3) return new Map(c.r);
  }
  const r = new Map<number, number[]>();
  for (const id of TEAMS.keys()) r.set(id, await roster(db, id));
  if ([...r.values()].every((l) => l.length >= 8)) setMeta(db, 'rosters', JSON.stringify({ ts: Date.now(), r: [...r] }));
  return r;
}

/** Ko će verovatno igrati: izveštaj o povredama + aktuelni sastav + učestalost nastupa. */
export function availability(lg: League, teamId: number, inj: Injury[], ros: number[]): Availability {
  const inRoster = new Set(ros), st = new Map(inj.map((i) => [i.pid, i.status]));
  const t = lg.team(teamId);
  const a = new Map<number, number>();
  for (const pid of new Set([...lg.pool(teamId), ...ros])) {
    const p = lg.players.get(pid);
    if (!p) continue;
    if (inRoster.size >= 8 && !inRoster.has(pid)) { a.set(pid, 0); continue; }
    const status = st.get(pid);
    if (status !== undefined) { a.set(pid, PROB[status] ?? 0.5); continue; }
    const idle = p.team === teamId ? t.gno - p.lastGno : 99;
    // Nije na listi povređenih: redovan igrač igra, a onaj van rotacije retko.
    a.set(pid, idle <= 1 ? Math.max(0.85, p.rate) : p.em >= 22 ? 0.8 : idle <= 4 ? Math.max(0.35, p.rate * 0.8) : 0.15);
  }
  return { a, pool: ros };
}

export async function update(db: DB, ctx: Ctx = newCtx(), log: (s: string) => void = console.log): Promise<{ live: boolean; nextStart: string | null }> {
  restoreState(db);
  const today = etDate();
  const boards: BoardGame[] = [];
  for (let d = -1; d <= DAYS_AHEAD; d++) boards.push(...await scoreboard(addDays(today, d)));

  // 1) Završeni mečevi: povuci kompletnu statistiku.
  const isFinal = db.prepare('SELECT final FROM games WHERE id=?');
  let fresh = 0;
  for (const g of boards) {
    if (!g.completed || g.postponed || (isFinal.get(g.id) as { final: number } | undefined)?.final) continue;
    try { if (await ingestSummary(db, g)) fresh++; } catch (e) { log(`Statistika za ${g.id} još nije dostupna: ${(e as Error).message}`); }
  }
  // Ako je računar dugo bio ugašen, nadoknadi propuštene dane iz otvorenog skupa.
  const lastFinal = (db.prepare('SELECT MAX(date) d FROM games WHERE final=1').get() as { d: string | null }).d;
  if (!lastFinal || (lastFinal < addDays(today, -2) && getMeta(db, 'catchup') !== today)) {
    await ingestAll(db);
    setMeta(db, 'catchup', today);
  }

  // 2) Kvote: početna, trenutna i svaki pomeraj.
  const upOdds = db.prepare(`INSERT INTO odds(game_id,provider,mlh_open,mla_open,mlh_close,mla_close,spread_open,spread_close,total_open,total_close,fetched)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET provider=excluded.provider, mlh_close=excluded.mlh_close, mla_close=excluded.mla_close,
    mlh_open=COALESCE(odds.mlh_open,excluded.mlh_open), mla_open=COALESCE(odds.mla_open,excluded.mla_open),
    spread_close=excluded.spread_close, total_close=excluded.total_close, fetched=excluded.fetched`);
  const lastSnap = db.prepare('SELECT mlh,mla FROM odds_snap WHERE game_id=? ORDER BY ts DESC LIMIT 1');
  const insSnap = db.prepare('INSERT OR IGNORE INTO odds_snap VALUES(?,?,?,?,?,?)');
  const now = new Date().toISOString();
  for (const g of boards) {
    const o = g.odds;
    if (g.state !== 'pre' || !o || noVig(o.mlh, o.mla) === null) continue;
    upOdds.run(g.id, o.provider, o.mlhOpen ?? o.mlh, o.mlaOpen ?? o.mla, o.mlh, o.mla, o.spreadOpen, o.spread, o.totalOpen, o.total, now);
    const s = lastSnap.get(g.id) as { mlh: number; mla: number } | undefined;
    if (!s || s.mlh !== o.mlh || s.mla !== o.mla) insSnap.run(g.id, now, o.mlh, o.mla, o.spread, o.total);
  }

  // 3) Model: ponovo se trenira kad stignu novi rezultati (najviše na 6 sati) ili kad ga nema.
  const trainedAt = getMeta(db, 'trainedAt');
  const total = countFinal(db);
  if (!ctx.model && fs.existsSync(MODEL_PATH)) ctx.model = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8')) as ModelFile;
  const trainedTotal = Number(getMeta(db, 'trainedTotal') ?? 0);
  const anyLive = boards.some((g) => g.state === 'in');
  const stale = total > trainedTotal && (!trainedAt || Date.now() - Date.parse(trainedAt) > 6 * 3600e3) && !anyLive;
  if (!ctx.model || ctx.model.version !== MODEL_VERSION || stale) {
    log('Treniram model na novim rezultatima...');
    const r = train(db);
    ctx.model = r.model; ctx.league = r.league; ctx.games = total;
  }
  if (!ctx.league || ctx.games !== total) { ctx.league = buildHistory(db).league; ctx.games = total; }
  const { league, model } = ctx;

  // 4) Predikcije i praćenje svakog meča.
  const inj = await injuries();
  const ros = await rosters(db);
  const names = new Map((db.prepare('SELECT pid,name FROM players').all() as { pid: number; name: string }[]).map((r) => [r.pid, r.name]));
  const nm = (pid: number) => names.get(pid) ?? `#${pid}`;
  const lessons = new Lessons();
  lessons.seg = new Map(model.seg);
  lessons.teams = new Map(model.teams);
  const store = new Map(loadLive(db).map((s) => [s.id, s]));
  const extra = new Map<number, { date: string; loc: number }[]>();
  for (const g of boards) if (!g.completed && !g.postponed) for (const id of [g.home, g.away]) extra.set(id, [...(extra.get(id) ?? []), { date: g.date, loc: g.home }]);

  for (const g of boards) {
    const prev = store.get(g.id);
    if (g.postponed) {
      if (prev && !prev.locked) {
        event(db, g.id, 'status', 2, `${team(g.away).abbr} @ ${team(g.home).abbr}`, 'Meč je odložen ili otkazan.');
        db.prepare('DELETE FROM live WHERE game_id=?').run(g.id);
      }
      continue;
    }
    const started = g.state !== 'pre' || Date.parse(g.start) <= Date.now();
    if (!started) {
      // Prognoze starog modela (sa kvotama) počinju ispočetka, da prva prognoza bude bez kvota.
      const old = prev?.initial ? prev : undefined;
      const next = predict(g, league, model, lessons, inj, ros, extra, nm, old);
      tx(db, () => {
        diffEvents(db, old, next);
        saveLive(db, next);
      });
    } else if (prev) {
      tx(db, () => {
        follow(db, prev, g, nm);
        saveLive(db, prev);
      });
    }
  }
  // Zaključani mečevi koji su ispali iz prozora (npr. računar je bio ugašen) razrešavaju se iz baze.
  const onBoard = new Set(boards.map((g) => g.id));
  for (const s of store.values()) {
    if (onBoard.has(s.id) || s.result) continue;
    const row = db.prepare('SELECT hs, as_, final FROM games WHERE id=?').get(s.id) as { hs: number; as_: number; final: number } | undefined;
    if (!row?.final) continue;
    tx(db, () => {
      lock(s);
      settle(db, s, row.hs, row.as_, nm);
      saveLive(db, s);
    });
  }

  backupState(db);
  const bt = JSON.parse(fs.readFileSync(BACKTEST_PATH, 'utf8')) as BacktestFile;
  exportAll(db, bt, league, loadLive(db));
  log(`${new Date().toLocaleTimeString('sr-RS')} provereno ${boards.length} mečeva, novih rezultata ${fresh}`);
  const starts = boards.filter((g) => g.state === 'pre' && !g.postponed && Date.parse(g.start) > Date.now()).map((g) => g.start).sort();
  return { live: anyLive, nextStart: starts[0] ?? null };
}

function predict(g: BoardGame, lg: League, model: ModelFile, lessons: Lessons, inj: Map<number, Injury[]>, ros: Map<number, number[]>,
  extra: Map<number, { date: string; loc: number }[]>, nm: (pid: number) => string, prev: Stored | undefined): Stored {
  const ih = inj.get(g.home) ?? [], ia = inj.get(g.away) ?? [];
  const { x, pre } = lg.features({ season: g.season, stype: g.stype, date: g.date, home: g.home, away: g.away, neutral: g.neutral ? 1 : 0 },
    availability(lg, g.home, ih, ros.get(g.home) ?? []), availability(lg, g.away, ia, ros.get(g.away) ?? []), extra);
  const bp = predictBase(model.base, x);
  const o = g.odds;
  const mkt = o ? noVig(o.mlh, o.mla) : null;
  // Samo statistika: kvota se koristi tek ispod, za prikaz i za papirne opklade.
  const base = applyStack(model.stack, bp.logits);
  const pHome = shift(base, (model.segGate ? lessons.segment(x, base) : 0) + (model.teamGate ? lessons.team(g.home, g.away) : 0));
  const pick = pHome >= 0.5 ? 'home' as const : 'away' as const;

  let value: GameView['value'] = null;
  if (o && mkt !== null) {
    for (const side of ['home', 'away'] as const) {
      const p = side === 'home' ? pHome : 1 - pHome, od = (side === 'home' ? o.mlh : o.mla)!;
      const e = ev(p, od);
      if (p >= 0.4 && e >= 0.05 && (!value || e > value.ev)) value = { side, odds: od, ev: e, stake: kelly(p, od) };
    }
  }
  const statusOf = (list: Injury[], pid: number) => list.find((i) => i.pid === pid);
  const row = (i: Injury, min: number, impact: number, prob: number): OutPlayer => ({
    name: nm(i.pid), min: Math.round(min), impact, prob, status: i.status === 'Out' ? 'Ne igra' : i.status === 'Day-To-Day' ? 'Neizvestan' : i.status,
    reason: i.reason, reported: i.reported, expected: i.expected, url: i.url,
  });
  const out = (l: Pregame['h'], list: Injury[]): OutPlayer[] => {
    const main = l.out.filter((p) => statusOf(list, p.pid)).map((p) => row(statusOf(list, p.pid)!, p.min, p.impact, p.prob));
    // Neizvesni se prikazuju svi, i kad su iz dubine klupe.
    const seen = new Set(l.out.map((p) => p.pid));
    const rest = list.filter((i) => i.status !== 'Out' && !seen.has(i.pid)).map((i) => row(i, lg.players.get(i.pid)?.em ?? 0, lg.impact(i.pid), PROB[i.status] ?? 0.5));
    return [...main, ...rest];
  };
  const now = new Date().toISOString();
  const openP = o ? noVig(o.mlhOpen, o.mlaOpen) : null;
  const pickOdds = o && mkt !== null ? (pick === 'home' ? o.mlh : o.mla) : null;
  const first = prev && prev.pick === pick && prev.firstOddsPick ? prev.firstOddsPick : pickOdds;
  return {
    id: g.id, date: g.date, start: g.start, season: g.season, home: ref(g.home), away: ref(g.away), neutral: g.neutral, playoff: g.stype !== 2, venue: g.venue,
    pHome, pick, confidence: Math.max(pHome, 1 - pHome), margin: bp.margin, total: bp.total, sdMargin: model.base.sdMargin,
    odds: o && mkt !== null ? { provider: o.provider, home: o.mlh!, away: o.mla!, homeOpen: o.mlhOpen, awayOpen: o.mlaOpen, spread: o.spread, total: o.total, implied: mkt } : null,
    highlight: isHighlight(Math.max(pHome, 1 - pHome), pickOdds), value, lineMove: mkt !== null && openP !== null ? mkt - openP : null,
    models: BASE_NAMES.map((name, i) => ({ name, p: sigmoid(bp.logits[i]) })),
    factors: explain(model.base, x).slice(0, 6), outHome: out(pre.h, ih), outAway: out(pre.a, ia), notes: notes(g, pre, mkt, openP, pHome),
    initial: prev?.initial ?? { p: pHome, pick, ts: now },
    created: prev?.created ?? now, locked: false, firstOddsPick: first, closeOddsPick: pickOdds, clv: null,
    live: { state: 'pre', hs: 0, as: 0, period: 0, clock: '', winProb: null }, result: null, postmortem: null, pre,
  };
}

function notes(g: BoardGame, pre: Pregame, mkt: number | null, openP: number | null, pure: number): string[] {
  const n: string[] = [];
  for (const [id, s] of [[g.home, pre.home], [g.away, pre.away]] as const) {
    if (s.b2b) n.push(`${team(id).name}: drugi meč u dva dana.`);
    if (s.km7 > 5500) n.push(`${team(id).name}: ${Math.round(s.km7 / 100) * 100} km puta u 7 dana.`);
  }
  if (!g.neutral && team(g.home).alt > 1200 && team(g.away).alt < 800) n.push(`${team(g.home).name} igra na ${team(g.home).alt} m nadmorske visine.`);
  if (mkt !== null && openP !== null && Math.abs(mkt - openP) >= 0.04) {
    n.push(`Kvota se pomerila ka timu ${team(mkt > openP ? g.home : g.away).name} (${pct(Math.abs(mkt - openP))} od otvaranja): mogući znak „pametnog novca” ili vesti o sastavu.`);
  }
  if (mkt !== null && Math.abs(pure - mkt) >= 0.1) n.push(`Naša analiza i kvota se razlikuju za ${pct(Math.abs(pure - mkt))}. Kvota ne utiče na prognozu.`);
  return n;
}

/** Beleži šta se promenilo od prethodne provere. */
function diffEvents(db: DB, prev: Stored | undefined, next: Stored): void {
  const title = `${next.away.abbr} @ ${next.home.abbr}`;
  const pickName = (s: Stored) => (s.pick === 'home' ? s.home.name : s.away.name);
  if (!prev) {
    event(db, next.id, 'prediction', 1, title, `Prva procena: ${pickName(next)} ${pct(next.confidence)}.`);
    return;
  }
  if (prev.pick !== next.pick) event(db, next.id, 'pick', 3, title, `Promena favorita: sada ${pickName(next)} ${pct(next.confidence)}.`);
  else if (Math.abs(prev.pHome - next.pHome) >= 0.03) event(db, next.id, 'prediction', 1, title, `${pickName(next)}: ${pct(prev.confidence)} → ${pct(next.confidence)}.`);
  for (const [a, b, t] of [[prev.outHome, next.outHome, next.home], [prev.outAway, next.outAway, next.away]] as const) {
    const before = new Map(a.map((p) => [p.name, p.status]));
    for (const p of b) if (before.get(p.name) !== p.status) event(db, next.id, 'injury', p.min >= 26 ? 3 : p.min >= 14 ? 2 : 1, title, `${p.name} (${t.abbr}): ${p.status.toLowerCase()}${p.reason ? `, ${p.reason}` : ''}. Izvor: ESPN.`);
    for (const p of a) if (!b.some((q) => q.name === p.name)) event(db, next.id, 'injury', p.min >= 26 ? 3 : p.min >= 14 ? 2 : 1, title, `${p.name} (${t.abbr}) više nije na listi povređenih.`);
  }
  if (prev.odds && next.odds && Math.abs(prev.odds.implied - next.odds.implied) >= 0.03) {
    const up = next.odds.implied > prev.odds.implied;
    event(db, next.id, 'odds', 2, title, `Kvota pomerena ka timu ${up ? next.home.name : next.away.name}: ${next.home.abbr} ${next.odds.home.toFixed(2)} / ${next.away.abbr} ${next.odds.away.toFixed(2)}.`);
  }
  if (!prev.highlight && next.highlight) event(db, next.id, 'value', 2, title, `Siguran izbor i dobra kvota: ${pickName(next)} ${pct(next.confidence)} na ${next.closeOddsPick!.toFixed(2)}.`);
}

/** Posle početka predikcija se više ne menja; beleži se završna kvota i CLV. */
function lock(s: Stored): void {
  if (s.locked) return;
  s.locked = true;
  if (s.firstOddsPick && s.closeOddsPick) s.clv = s.firstOddsPick / s.closeOddsPick - 1;
}

function follow(db: DB, s: Stored, g: BoardGame, nm: (pid: number) => string): void {
  const title = `${s.away.abbr} @ ${s.home.abbr}`;
  const pickName = s.pick === 'home' ? s.home.name : s.away.name;
  if (!s.locked) {
    lock(s);
    event(db, s.id, 'lock', 1, title, `Predikcija zaključana: ${pickName} ${pct(s.confidence)}.`);
  }
  const before: LiveState = s.live;
  if (g.state === 'pre') return;
  const frac = remaining(g.period, g.clock);
  const wp = g.completed ? null : inPlayProb(g.hs - g.as, frac, s.margin, s.sdMargin);
  s.live = { state: g.state, hs: g.hs, as: g.as, period: g.period, clock: g.clock, winProb: wp };
  const score = `${s.home.abbr} ${g.hs} : ${g.as} ${s.away.abbr}`;
  if (before.state === 'pre' && g.state === 'in') event(db, s.id, 'start', 1, title, 'Meč je počeo.');
  if (g.state === 'in' && before.state === 'in') {
    if (before.period <= 2 && g.period >= 3) event(db, s.id, 'half', 1, title, `Poluvreme je iza nas: ${score}.`);
    if (before.period <= 4 && g.period > 4) event(db, s.id, 'ot', 2, title, `Produžetak: ${score}.`);
    const b = before.winProb, side = (p: number) => (s.pick === 'home' ? p : 1 - p);
    if (b !== null && wp !== null && side(b) >= 0.4 && side(wp) < 0.25) event(db, s.id, 'danger', 2, title, `Naš izbor (${pickName}) je u problemu: ${score}, šansa ${pct(side(wp))}.`);
    if (b !== null && wp !== null && side(b) <= 0.6 && side(wp) > 0.8) event(db, s.id, 'good', 1, title, `Naš izbor (${pickName}) preuzima meč: ${score}, šansa ${pct(side(wp))}.`);
  }
  if (g.completed && !s.result) settle(db, s, g.hs, g.as, nm);
}

/** Upisuje ishod; za promašaj radi analizu. Čeka se kompletna statistika. */
function settle(db: DB, s: Stored, hs: number, as: number, nm: (pid: number) => string): void {
  const tb = db.prepare('SELECT * FROM team_box WHERE game_id=?').all(s.id) as unknown as TeamBox[];
  const hb = tb.find((t) => t.team_id === s.home.id), ab = tb.find((t) => t.team_id === s.away.id);
  if (!hb || !ab || hs === as) return;
  const hit = (hs > as) === (s.pick === 'home');
  s.live = { ...s.live, state: 'post', hs, as, winProb: null };
  s.result = { hs, as, hit };
  const title = `${s.away.abbr} @ ${s.home.abbr}`;
  const pickName = s.pick === 'home' ? s.home.name : s.away.name;
  if (!hit) {
    const ps = db.prepare('SELECT * FROM player_box WHERE game_id=?').all(s.id) as unknown as PlayerBox[];
    s.postmortem = postmortem({ pickHome: s.pick === 'home', hs, as, pre: s.pre, hb, ab, ps, homeId: s.home.id, awayId: s.away.id, pickName, name: nm });
  }
  event(db, s.id, hit ? 'hit' : 'miss', 2, title,
    `${hit ? 'Pogodak' : 'Promašaj'}: ${s.home.abbr} ${hs} : ${as} ${s.away.abbr} (izbor ${pickName}, ${pct(s.confidence)}).${s.postmortem ? ` Razlog: ${s.postmortem.category.toLowerCase()}.` : ''}`);
}

