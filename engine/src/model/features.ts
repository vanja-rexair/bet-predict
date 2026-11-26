import type { DB } from '../db.ts';
import { FIRST_SEASON, dayDiff } from '../config.ts';
import { team as T, km } from '../teams.ts';
import { Elo, Glicko } from '../ml/ratings.ts';
import { clamp, logit } from '../ml/metrics.ts';

export interface Game {
  id: number; season: number; stype: number; date: string; start: string; home: number; away: number;
  hs: number; as_: number; final: number; neutral: number;
}
export interface TeamBox {
  game_id: number; team_id: number; pts: number; fgm: number; fga: number; tpm: number; tpa: number; ftm: number; fta: number;
  orb: number; drb: number; tov: number; ast: number; stl: number; blk: number; pf: number;
}
export interface PlayerBox {
  game_id: number; team_id: number; pid: number; min: number; fgm: number; fga: number; tpm: number; ftm: number; fta: number; orb: number;
  drb: number; ast: number; stl: number; blk: number; tov: number; pf: number; pm: number; pts: number; starter: number;
}

/** Grupe služe za objašnjenja predikcija u aplikaciji. */
export const GROUPS = {
  rating: 'Snaga tima (Elo/Glicko)', eff: 'Efikasnost po posedu', four: 'Četiri faktora', luck: 'Regresija ka sredini (šut)',
  form: 'Forma', rest: 'Zamor i raspored', travel: 'Putovanje i visina', lineup: 'Sastav i povrede', home: 'Domaći teren', ctx: 'Kontekst',
} as const;
type Group = keyof typeof GROUPS;

/** Sve vrednosti su iz ugla domaćina (pozitivno = prednost domaćina) osim onih koje opisuju okolnosti. */
export const FEATURES: [string, Group][] = [
  ['eloLogit', 'rating'], ['glickoLogit', 'rating'], ['glickoRd', 'rating'],
  ['expMargin', 'eff'], ['netAdj', 'eff'], ['pace', 'eff'], ['expTotal', 'eff'],
  ['efgNet', 'four'], ['tovNet', 'four'], ['orbNet', 'four'], ['ftrNet', 'four'],
  ['luck3', 'luck'], ['oppLuck3', 'luck'],
  ['form5', 'form'], ['win10', 'form'], ['resid', 'form'], ['h2h', 'form'],
  ['restH', 'rest'], ['restA', 'rest'], ['b2bH', 'rest'], ['b2bA', 'rest'], ['in4H', 'rest'], ['in4A', 'rest'], ['in5H', 'rest'], ['in5A', 'rest'],
  ['games7', 'rest'], ['load7', 'rest'],
  ['km7', 'travel'], ['tzShift', 'travel'], ['altitude', 'travel'],
  ['lineup', 'lineup'], ['missH', 'lineup'], ['missA', 'lineup'], ['missUsg', 'lineup'], ['missMin', 'lineup'], ['starGap', 'lineup'],
  ['playerElo', 'lineup'], ['playerMargin', 'lineup'], ['continuity', 'lineup'],
  ['homeSplit', 'home'], ['leagueHca', 'home'], ['neutral', 'home'],
  ['progress', 'ctx'], ['playoff', 'ctx'],
];
export const NF = FEATURES.length;

/** Dostupnost igrača po meču: 1 = igra, 0 = ne igra, između = neizvesno. */
export interface Availability { a: Map<number, number>; pool?: number[] }

interface PlayerState {
  team: number; em: number; rate: number; sMin: number; sGs: number; sOn: number; sUse: number; sTeamUse: number; lastGno: number; games: number;
  /** Rejting igrača: koliko poena na 48 minuta vredi njegovo prisustvo, uči se iz svakog meča. */
  r: number;
}
interface Recent { date: string; loc: number }
interface TeamState {
  off: number; def: number; pace: number;
  efg: number; tov: number; orb: number; ftr: number; dEfg: number; dTov: number; dOrb: number; dFtr: number; p3: number; dP3: number; r3: number;
  last3: [number, number, number, number][]; margins: number[]; resid: number; homeDev: number; awayDev: number;
  recent: Recent[]; load: { date: string; min: number }[]; gno: number; seasonGames: number; seen: boolean;
}
export interface LineupInfo {
  str: number; miss: number; missUsg: number; missMin: number; star: number; elo: number; cont: number;
  /** Igrači koji se najviše osećaju u sastavu ako ih nema. */
  out: { pid: number; min: number; impact: number; usg: number; prob: number }[];
  /** Ključni igrači i njihovi očekivani minuti. */
  key: { pid: number; min: number }[];
}
/** Očekivanja pre meča, koristi ih analiza promašaja. */
export interface Pregame {
  expMargin: number; expTotal: number; pace: number; home: Side; away: Side; h: LineupInfo; a: LineupInfo;
}
interface Side { p3: number; efg: number; tov: number; orb: number; ftr: number; b2b: boolean; rest: number; km7: number; elo: number; off: number; def: number; pace: number }

const REPLACEMENT = -3;
/** Početni rejting igrača bez istorije i brzina učenja (izabrana na sezonama 2018/19 do 2022/23). */
const NEWCOMER = -1.5;
const PLAYER_K = 0.01;
const poss = (b: TeamBox) => b.fga - b.orb + b.tov + 0.44 * b.fta;

export class League {
  elo = new Elo();
  glicko = new Glicko();
  teams = new Map<number, TeamState>();
  players = new Map<number, PlayerState>();
  h2h = new Map<string, number[]>();
  season = 0;
  lgEff = 106; lgP3 = 0.36; lgGs = 13.5; hca = 2.6;

  team(id: number): TeamState {
    let t = this.teams.get(id);
    if (!t) {
      t = {
        off: 0, def: 0, pace: 97, efg: 0.5, tov: 0.135, orb: 0.25, ftr: 0.26, dEfg: 0.5, dTov: 0.135, dOrb: 0.25, dFtr: 0.26, p3: 0.36, dP3: 0.36, r3: 0.35,
        last3: [], margins: [], resid: 0, homeDev: 0, awayDev: 0, recent: [], load: [], gno: 0, seasonGames: 0, seen: false,
      };
      this.teams.set(id, t);
    }
    return t;
  }

  private newSeason(season: number): void {
    this.season = season;
    this.elo.newSeason();
    this.glicko.newSeason();
    this.h2h.clear();
    const all = [...this.teams.values()];
    const keys = ['pace', 'efg', 'tov', 'orb', 'ftr', 'dEfg', 'dTov', 'dOrb', 'dFtr', 'p3', 'dP3', 'r3'] as const;
    for (const k of keys) {
      const avg = all.reduce((s, t) => s + t[k], 0) / (all.length || 1);
      for (const t of all) t[k] = avg + 0.55 * (t[k] - avg);
    }
    for (const t of all) {
      t.off *= 0.6; t.def *= 0.6; t.resid = 0; t.last3 = []; t.margins = []; t.recent = []; t.load = []; t.seasonGames = 0;
      t.homeDev *= 0.5; t.awayDev *= 0.5;
    }
    for (const p of this.players.values()) { p.sMin *= 0.65; p.sGs *= 0.65; p.sOn *= 0.65; p.sUse *= 0.65; p.sTeamUse *= 0.65; p.r *= 0.85; }
  }

  /** Procena uticaja igrača (poena na 48 min, u odnosu na prosek lige): box deo + On/Off deo, skupljeni ka sredini. */
  impact(pid: number): number {
    const p = this.players.get(pid);
    if (!p) return REPLACEMENT;
    const K = 250;
    const gs36 = ((p.sGs + ((this.lgGs - 4) / 36) * K) / (p.sMin + K)) * 36;
    const onOff = (p.sOn / (p.sMin + 1200)) * 48;
    return clamp(0.6 * (gs36 - this.lgGs) + 0.25 * onOff, -6, 14);
  }
  usage(pid: number): number {
    const p = this.players.get(pid);
    return p && p.sTeamUse > 0 ? clamp(p.sUse / p.sTeamUse, 0.05, 0.4) : 0.15;
  }

  /** Igrači koji se smatraju delom rotacije tima. */
  pool(teamId: number): number[] {
    const t = this.team(teamId);
    const out: number[] = [];
    for (const [pid, p] of this.players) if (p.team === teamId && t.gno - p.lastGno <= 25) out.push(pid);
    return out;
  }

  /** Vrednost zamene: minute odsutnih preuzimaju preostali, a ako ih nema dovoljno, igrač zamenskog nivoa. */
  lineup(teamId: number, av: Availability): LineupInfo {
    const ids = new Set([...this.pool(teamId), ...(av.pool ?? [])]);
    const rows = [...ids].filter((pid) => this.players.has(pid)).map((pid) => {
      const p = this.players.get(pid)!;
      return { pid, em: p.em, rate: p.rate, a: av.a.get(pid) ?? 0, imp: this.impact(pid), r: p.r, usg: this.usage(pid) };
    });
    const strength = (w: (r: (typeof rows)[0]) => number, v: (r: (typeof rows)[0]) => number, filler: number) => {
      const top = rows.map((r) => ({ v: v(r), w: w(r) })).filter((r) => r.w > 0.5).sort((x, y) => y.w - x.w).slice(0, 10);
      const sum = top.reduce((s, r) => s + r.w, 0);
      const f = sum > 0 ? Math.min(240 / sum, 1.35) : 0;
      let used = 0, s = 0;
      for (const r of top) {
        const m = Math.min(r.w * f, 40);
        used += m;
        s += (m / 48) * r.v;
      }
      return s + (Math.max(0, 240 - used) / 48) * filler;
    };
    const full = strength((r) => r.em * r.rate, (r) => r.imp, REPLACEMENT);
    const str = strength((r) => r.em * r.a, (r) => r.imp, REPLACEMENT);
    const elo = strength((r) => r.em * r.a, (r) => r.r, NEWCOMER);
    const cont = rows.reduce((s, r) => s + r.em * r.a * r.rate, 0) / 240;
    let missUsg = 0, missMin = 0, star = -10;
    const out: LineupInfo['out'] = [];
    for (const r of rows) {
      const gone = (1 - r.a) * r.rate;
      missMin += gone * r.em;
      missUsg += (gone * r.em * r.usg) / 48;
      star = Math.max(star, r.a * r.imp + (1 - r.a) * REPLACEMENT);
      if (r.a < 0.95 && r.em >= 14 && r.rate > 0.1) out.push({ pid: r.pid, min: r.em, impact: r.imp, usg: r.usg, prob: r.a });
    }
    const key = rows.filter((r) => r.a > 0.5 && r.em >= 24).sort((x, y) => y.imp * y.em - x.imp * x.em).slice(0, 4).map((r) => ({ pid: r.pid, min: r.em }));
    out.sort((x, y) => y.impact * y.min - x.impact * x.min);
    return { str, miss: Math.max(0, full - str), missUsg, missMin, star: rows.length ? star : 0, out: out.slice(0, 8), key, elo, cont };
  }

  private schedule(teamId: number, date: string, loc: number, extra: Recent[] = []) {
    const t = this.team(teamId);
    const rec = [...t.recent, ...extra.filter((e) => e.date < date)].filter((r) => r.date < date && dayDiff(date, r.date) <= 14);
    rec.sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = rec[rec.length - 1];
    const ago = rec.map((r) => dayDiff(date, r.date));
    const rest = last ? Math.min(ago[ago.length - 1], 6) : 6;
    let dist = 0, tz = 0;
    let prev = T(teamId);
    const path = [...rec.filter((r) => dayDiff(date, r.date) <= 7), { date, loc }];
    if (path.length > 1) prev = T(path[0].loc);
    for (const p of path) {
      const c = T(p.loc);
      dist += km(prev, c);
      tz += Math.abs(c.tz - prev.tz);
      prev = c;
    }
    const within = (d: number) => ago.filter((x) => x <= d).length + 1;
    const load = t.load.filter((l) => l.date < date && dayDiff(date, l.date) <= 7).reduce((s, l) => s + l.min, 0);
    return { rest, b2b: rest === 1, in4: within(3) >= 3, in5: within(4) >= 4, g7: within(6), km7: dist, tz, load };
  }

  /** Računa karakteristike isključivo iz stanja pre meča. */
  features(g: Pick<Game, 'season' | 'stype' | 'date' | 'home' | 'away' | 'neutral'>, avH: Availability, avA: Availability,
    extra?: Map<number, Recent[]>): { x: Float64Array; pre: Pregame } {
    if (g.season !== this.season) this.newSeason(g.season);
    const H = this.team(g.home), A = this.team(g.away);
    const neu = g.neutral === 1;
    const sh = this.schedule(g.home, g.date, g.home, extra?.get(g.home)), sa = this.schedule(g.away, g.date, g.home, extra?.get(g.away));
    const lh = this.lineup(g.home, avH), la = this.lineup(g.away, avA);
    const pace = H.pace + A.pace - this.lgPace();
    const hca = neu ? 0 : this.hca;
    const expMargin = ((H.off + A.def - A.off - H.def) * pace) / 100 + hca;
    const expTotal = ((2 * this.lgEff + H.off + A.def + A.off + H.def) * pace) / 100;
    const luck = (t: TeamState, o: boolean) => {
      const m = t.last3.reduce((s, r) => s + r[o ? 2 : 0], 0), a = t.last3.reduce((s, r) => s + r[o ? 3 : 1], 0);
      if (a < 30) return 0;
      return m / a - (o ? t.dP3 : t.p3);
    };
    const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
    const win = (t: TeamState) => (t.margins.filter((m) => m > 0).length + 2) / (t.margins.length + 4);
    const form = (t: TeamState) => mean(t.margins.slice(-5)) * (Math.min(t.margins.length, 5) / 5);
    const key = g.home < g.away ? `${g.home}-${g.away}` : `${g.away}-${g.home}`;
    const h2h = mean(this.h2h.get(key) ?? []) * (g.home < g.away ? 1 : -1);
    const b = (v: boolean) => (v ? 1 : 0);
    const gl = { h: this.glicko.get(g.home), a: this.glicko.get(g.away) };
    const x = Float64Array.from([
      logit(this.elo.expected(g.home, g.away, neu)), logit(this.glicko.expected(g.home, g.away, neu)), Math.hypot(gl.h.rd, gl.a.rd),
      expMargin, H.off - H.def - (A.off - A.def), pace, expTotal,
      H.efg - H.dEfg - (A.efg - A.dEfg), H.dTov - H.tov - (A.dTov - A.tov), H.orb - H.dOrb - (A.orb - A.dOrb), H.ftr - H.dFtr - (A.ftr - A.dFtr),
      luck(H, false) - luck(A, false), luck(A, true) - luck(H, true),
      form(H) - form(A), win(H) - win(A), H.resid - A.resid, h2h,
      sh.rest, sa.rest, b(sh.b2b), b(sa.b2b), b(sh.in4), b(sa.in4), b(sh.in5), b(sa.in5), sh.g7 - sa.g7, (sh.load - sa.load) / 100,
      (sh.km7 - sa.km7) / 1000, sh.tz - sa.tz, neu ? 0 : Math.max(0, T(g.home).alt - T(g.away).alt) / 1000,
      lh.str - la.str, lh.miss, la.miss, lh.missUsg - la.missUsg, (lh.missMin - la.missMin) / 48, lh.star - la.star,
      lh.elo - la.elo, ((lh.elo - la.elo) * pace) / 100 + hca, lh.cont - la.cont,
      neu ? 0 : H.homeDev - A.awayDev, hca, b(neu),
      Math.min(H.seasonGames, A.seasonGames, 60), b(g.stype !== 2),
    ]);
    const side = (id: number, t: TeamState, s: typeof sh): Side => ({
      p3: t.p3, efg: t.efg, tov: t.tov, orb: t.orb, ftr: t.ftr, b2b: s.b2b, rest: s.rest, km7: s.km7, elo: this.elo.get(id),
      off: this.lgEff + t.off, def: this.lgEff + t.def, pace: t.pace,
    });
    return { x, pre: { expMargin, expTotal, pace, home: side(g.home, H, sh), away: side(g.away, A, sa), h: lh, a: la } };
  }

  private lgPace(): number {
    let s = 0, n = 0;
    for (const t of this.teams.values()) if (t.seen) { s += t.pace; n++; }
    return n ? s / n : 97;
  }

  /** Odstupanje od očekivane razlike deli se igračima po minutima; novi igrači se uče brže. */
  private learnPlayers(g: Game, box: PlayerBox[], margin: number): void {
    let expected = g.neutral === 1 ? 0 : this.hca;
    for (const p of box) expected += (p.team_id === g.home ? 1 : -1) * (this.players.get(p.pid)?.r ?? NEWCOMER) * (p.min / 48);
    const miss = clamp(margin, -28, 28) - expected;
    for (const p of box) {
      const s = this.players.get(p.pid);
      if (!s) continue;
      const k = PLAYER_K * (1 + 4 / (1 + s.games / 15));
      s.r += (k * (p.team_id === g.home ? 1 : -1) * miss * (p.min / 48) * 2) / 5 + 0.02 * (this.impact(p.pid) - s.r) * (p.min / 36)
        + 0.001 * (p.pm - ((p.team_id === g.home ? 1 : -1) * margin * p.min) / 48);
    }
  }

  /** Uči iz završenog meča: pomera rejtinge, efikasnost i ocene igrača. */
  update(g: Game, hb: TeamBox, ab: TeamBox, players: PlayerBox[]): void {
    if (g.season !== this.season) this.newSeason(g.season);
    const H = this.team(g.home), A = this.team(g.away);
    const neu = g.neutral === 1;
    const margin = g.hs - g.as_;
    this.elo.update(g.home, g.away, g.hs, g.as_, neu);
    this.glicko.update(g.home, g.away, margin > 0, neu);

    // Minuti u produžecima povećavaju broj poseda; tempo se svodi na 48 minuta.
    const teamMin = players.filter((p) => p.team_id === g.home).reduce((s, p) => s + p.min, 0);
    const ot = Math.max(0, Math.round((teamMin / 5 - 48) / 5));
    const raw = (poss(hb) + poss(ab)) / 2;
    const pace = (raw * 48) / (48 + 5 * ot);
    const eh = (g.hs / raw) * 100, ea = (g.as_ / raw) * 100;
    const hcaEff = neu ? 0 : (this.hca / 2 / pace) * 100;
    const k = 0.045 + 0.1 / (1 + Math.min(H.seasonGames, A.seasonGames) / 6);
    const errH = clamp(eh - (this.lgEff + H.off + A.def + hcaEff), -22, 22);
    const errA = clamp(ea - (this.lgEff + A.off + H.def - hcaEff), -22, 22);
    const expMargin = ((H.off + A.def - A.off - H.def) * pace) / 100 + (neu ? 0 : this.hca);
    H.off += k * errH; A.def += k * errH; A.off += k * errA; H.def += k * errA;
    this.lgEff += 0.004 * ((eh + ea) / 2 - this.lgEff);
    if (!neu) this.hca += 0.002 * (clamp(margin, -25, 25) - expMargin);

    const ew = (t: TeamState, o: TeamBox, d: TeamBox) => {
      const a = 1 / Math.min(14, 5 + t.seasonGames * 0.6);
      const up = (key: 'pace' | 'efg' | 'tov' | 'orb' | 'ftr' | 'dEfg' | 'dTov' | 'dOrb' | 'dFtr' | 'r3', v: number, f = 1) => { t[key] += a * f * (v - t[key]); };
      up('pace', pace);
      up('efg', (o.fgm + 0.5 * o.tpm) / o.fga); up('dEfg', (d.fgm + 0.5 * d.tpm) / d.fga);
      up('tov', o.tov / poss(o)); up('dTov', d.tov / poss(d));
      up('orb', o.orb / Math.max(1, o.orb + d.drb)); up('dOrb', d.orb / Math.max(1, d.orb + o.drb));
      up('ftr', o.fta / o.fga); up('dFtr', d.fta / d.fga); up('r3', o.tpa / o.fga);
      // Procenat za tri je veoma bučan, pa se uči sporo i drži blizu proseka lige.
      if (o.tpa > 5) t.p3 += 0.03 * (o.tpm / o.tpa - t.p3) + 0.01 * (this.lgP3 - t.p3);
      if (d.tpa > 5) t.dP3 += 0.015 * (d.tpm / d.tpa - t.dP3) + 0.02 * (this.lgP3 - t.dP3);
      t.last3.push([o.tpm, o.tpa, d.tpm, d.tpa]);
      if (t.last3.length > 5) t.last3.shift();
    };
    ew(H, hb, ab); ew(A, ab, hb);
    if (hb.tpa + ab.tpa > 10) this.lgP3 += 0.004 * ((hb.tpm + ab.tpm) / (hb.tpa + ab.tpa) - this.lgP3);

    this.learnPlayers(g, players, margin);
    const surprise = clamp(margin - expMargin, -25, 25);
    const after = (t: TeamState, m: number, s: number, home: boolean) => {
      t.margins.push(m);
      if (t.margins.length > 10) t.margins.shift();
      t.resid += 0.15 * (s - t.resid);
      if (!neu) { if (home) t.homeDev += 0.05 * (s - t.homeDev); else t.awayDev += 0.05 * (s - t.awayDev); }
      t.recent.push({ date: g.date, loc: g.home });
      if (t.recent.length > 9) t.recent.shift();
      t.gno++; t.seasonGames++; t.seen = true;
    };
    after(H, margin, surprise, true);
    after(A, -margin, -surprise, false);
    const key = g.home < g.away ? `${g.home}-${g.away}` : `${g.away}-${g.home}`;
    const list = this.h2h.get(key) ?? [];
    list.push(g.home < g.away ? margin : -margin);
    this.h2h.set(key, list);

    for (const [id, t, box, m] of [[g.home, H, hb, margin], [g.away, A, ab, -margin]] as [number, TeamState, TeamBox, number][]) {
      const mine = players.filter((p) => p.team_id === id);
      const teamUse = box.fga + 0.44 * box.fta + box.tov;
      const played = new Set(mine.map((p) => p.pid));
      for (const [pid, s] of this.players) if (s.team === id && !played.has(pid) && t.gno - s.lastGno <= 60) s.rate += 0.12 * (0 - s.rate);
      for (const p of mine) {
        const gs = p.pts + 0.4 * p.fgm - 0.7 * p.fga - 0.4 * (p.fta - p.ftm) + 0.7 * p.orb + 0.3 * p.drb + p.stl + 0.7 * p.ast + 0.7 * p.blk - 0.4 * p.pf - p.tov;
        let s = this.players.get(p.pid);
        if (!s) {
          s = { team: id, em: p.min * 0.8, rate: 0.6, sMin: 0, sGs: 0, sOn: 0, sUse: 0, sTeamUse: 0, lastGno: t.gno, games: 0, r: NEWCOMER };
          this.players.set(p.pid, s);
        }
        s.team = id;
        s.em += 0.14 * (p.min - s.em);
        s.rate += 0.12 * (1 - s.rate);
        s.sMin = s.sMin * 0.975 + p.min;
        s.sGs = s.sGs * 0.975 + gs;
        s.sOn = s.sOn * 0.975 + (p.pm - (m * p.min) / 48);
        s.sUse = s.sUse * 0.975 + p.fga + 0.44 * p.fta + p.tov;
        s.sTeamUse = s.sTeamUse * 0.975 + (teamUse * p.min) / 48;
        s.lastGno = t.gno;
        s.games++;
        this.lgGs += 0.0002 * p.min / 36 * ((gs / p.min) * 36 - this.lgGs);
      }
      const top = mine.map((p) => p.min).sort((x, y) => y - x).slice(0, 8).reduce((x, y) => x + y, 0);
      t.load.push({ date: g.date, min: top });
      if (t.load.length > 6) t.load.shift();
    }
  }
}

export interface Row { g: Game; x: Float64Array; y: number; margin: number; total: number; pre: Pregame; hb: TeamBox; ab: TeamBox; ps: PlayerBox[] }

/** Prolazi kroz celu istoriju hronološki i za svaki meč pravi karakteristike pa tek onda uči iz njega. */
export function buildHistory(db: DB): { rows: Row[]; league: League } {
  const games = db.prepare('SELECT * FROM games WHERE final=1 ORDER BY date, start, id').all() as unknown as Game[];
  const tb = new Map<number, Map<number, TeamBox>>();
  for (const r of db.prepare('SELECT * FROM team_box').iterate() as Iterable<any>) {
    let m = tb.get(r.game_id);
    if (!m) tb.set(r.game_id, (m = new Map()));
    m.set(r.team_id, r);
  }
  const pb = new Map<number, PlayerBox[]>();
  for (const r of db.prepare('SELECT * FROM player_box').iterate() as Iterable<any>) {
    let m = pb.get(r.game_id);
    if (!m) pb.set(r.game_id, (m = []));
    m.push(r);
  }
  const league = new League();
  const rows: Row[] = [];
  for (const g of games) {
    const h = tb.get(g.id)?.get(g.home), a = tb.get(g.id)?.get(g.away), ps = pb.get(g.id) ?? [];
    if (!h || !a || g.hs === g.as_) continue;
    const av = (id: number): Availability => {
      const pool = ps.filter((p) => p.team_id === id).map((p) => p.pid);
      return { a: new Map(pool.map((p) => [p, 1])), pool };
    };
    const { x, pre } = league.features(g, av(g.home), av(g.away));
    if (g.season > FIRST_SEASON) rows.push({ g, x, y: g.hs > g.as_ ? 1 : 0, margin: g.hs - g.as_, total: g.hs + g.as_, pre, hb: h, ab: a, ps });
    league.update(g, h, a, ps);
  }
  return { rows, league };
}
