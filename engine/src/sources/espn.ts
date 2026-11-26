import type { DB } from '../db.ts';
import { tx } from '../db.ts';
import { isNbaTeam } from '../teams.ts';
import { american, noVig } from '../market.ts';
import { espnUrl, injuryReason } from '../model/injury.ts';
import { getJson } from './http.ts';
import { etDate } from '../config.ts';
import { buildStints, espnPlays, rosterOf, saveStints } from '../model/stints.ts';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';

const n = (s: unknown): number => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};
const line = (s: unknown): number | null => {
  if (s === null || s === undefined || s === '') return null;
  const v = Number(String(s).replace(/^[ou+]+/i, ''));
  return Number.isFinite(v) ? v : null;
};

export interface BoardOdds {
  provider: string; mlh: number | null; mla: number | null; spread: number | null; total: number | null;
  mlhOpen: number | null; mlaOpen: number | null; spreadOpen: number | null; totalOpen: number | null;
}
export interface BoardGame {
  id: number; season: number; stype: number; date: string; start: string; home: number; away: number;
  state: 'pre' | 'in' | 'post'; completed: boolean; postponed: boolean; hs: number; as: number;
  period: number; clock: string; neutral: boolean; venue: string; odds: BoardOdds | null;
}

/** Raspored, rezultati uživo i trenutne kvote za jedan dan. */
export async function scoreboard(date: string): Promise<BoardGame[]> {
  const j = await getJson(`${SITE}/scoreboard?dates=${date.replaceAll('-', '')}&limit=50`);
  const out: BoardGame[] = [];
  for (const e of j?.events ?? []) {
    const c = e.competitions[0];
    const h = c.competitors.find((x: any) => x.homeAway === 'home');
    const a = c.competitors.find((x: any) => x.homeAway === 'away');
    const hid = n(h?.team?.id), aid = n(a?.team?.id);
    if (!isNbaTeam(hid) || !isNbaTeam(aid) || ![2, 3, 5].includes(e.season?.type)) continue;
    const o = (c.odds ?? []).find((x: any) => x && (x.moneyline || x.spread !== undefined));
    out.push({
      id: n(e.id), season: e.season.year, stype: e.season.type, date: etDate(new Date(e.date)), start: e.date, home: hid, away: aid,
      state: e.status.type.state, completed: !!e.status.type.completed,
      postponed: /POSTPONED|CANCEL/.test(e.status.type.name), hs: n(h.score), as: n(a.score),
      period: n(e.status.period), clock: e.status.displayClock ?? '', neutral: !!c.neutralSite, venue: c.venue?.fullName ?? '',
      odds: o ? {
        provider: o.provider?.name ?? '',
        mlh: american(o.moneyline?.home?.close?.odds ?? o.homeTeamOdds?.moneyLine),
        mla: american(o.moneyline?.away?.close?.odds ?? o.awayTeamOdds?.moneyLine),
        mlhOpen: american(o.moneyline?.home?.open?.odds), mlaOpen: american(o.moneyline?.away?.open?.odds),
        spread: line(o.pointSpread?.home?.close?.line ?? o.spread), spreadOpen: line(o.pointSpread?.home?.open?.line),
        total: line(o.total?.over?.close?.line ?? o.overUnder), totalOpen: line(o.total?.over?.open?.line),
      } : null,
    });
  }
  return out;
}

/** Upisuje kompletan box score završenog meča. Vraća false ako statistika još nije potpuna. */
export async function ingestSummary(db: DB, g: BoardGame): Promise<boolean> {
  const j = await getJson(`${SITE}/summary?event=${g.id}`);
  const teams = j?.boxscore?.teams, pls = j?.boxscore?.players;
  if (!teams || teams.length !== 2 || !pls || pls.length !== 2) return false;
  const boxes = teams.map((t: any) => {
    const s: Record<string, string> = Object.fromEntries((t.statistics ?? []).map((x: any) => [x.name, x.displayValue]));
    const pair = (k: string) => String(s[k] ?? '0-0').split('-').map(n);
    const [fgm, fga] = pair('fieldGoalsMade-fieldGoalsAttempted');
    const [tpm, tpa] = pair('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
    const [ftm, fta] = pair('freeThrowsMade-freeThrowsAttempted');
    return {
      tid: n(t.team.id), fgm, fga, tpm, tpa, ftm, fta, orb: n(s.offensiveRebounds), drb: n(s.defensiveRebounds),
      tov: Math.max(n(s.totalTurnovers), n(s.turnovers)), ast: n(s.assists), stl: n(s.steals), blk: n(s.blocks), pf: n(s.fouls),
    };
  });
  if (boxes.some((b: any) => b.fga < 40)) return false;
  tx(db, () => {
    db.prepare(`INSERT INTO games(id,season,stype,date,start,home,away,hs,as_,final,neutral) VALUES(?,?,?,?,?,?,?,?,?,1,?)
      ON CONFLICT(id) DO UPDATE SET hs=excluded.hs, as_=excluded.as_, final=1`)
      .run(g.id, g.season, g.stype, g.date, g.start, g.home, g.away, g.hs, g.as, g.neutral ? 1 : 0);
    const insT = db.prepare('INSERT OR REPLACE INTO team_box VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const b of boxes) {
      insT.run(g.id, b.tid, b.tid === g.home ? g.hs : g.as, b.fgm, b.fga, b.tpm, b.tpa, b.ftm, b.fta, b.orb, b.drb, b.tov, b.ast, b.stl, b.blk, b.pf);
    }
    const insP = db.prepare('INSERT OR REPLACE INTO player_box VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const insN = db.prepare('INSERT INTO players(pid,name) VALUES(?,?) ON CONFLICT(pid) DO UPDATE SET name=excluded.name');
    for (const t of pls) {
      const st = t.statistics?.[0];
      if (!st) continue;
      const keys: string[] = st.keys;
      for (const a of st.athletes ?? []) {
        if (a.didNotPlay || !a.stats?.length) continue;
        const v = (key: string) => a.stats[keys.indexOf(key)] ?? '0';
        const pr = (key: string) => String(v(key)).split('-').map(n);
        const min = n(v('minutes'));
        if (!(min > 0)) continue;
        const [fgm, fga] = pr('fieldGoalsMade-fieldGoalsAttempted');
        const [tpm] = pr('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
        const [ftm, fta] = pr('freeThrowsMade-freeThrowsAttempted');
        const pid = n(a.athlete.id);
        insP.run(g.id, n(t.team.id), pid, min, fgm, fga, tpm, ftm, fta, n(v('offensiveRebounds')), n(v('defensiveRebounds')),
          n(v('assists')), n(v('steals')), n(v('blocks')), n(v('turnovers')), n(v('fouls')),
          n(String(v('plusMinus')).replace('+', '')), n(v('points')), a.starter ? 1 : 0);
        insN.run(pid, a.athlete.displayName);
      }
    }
  });
  // Zapis poen po poen: ko je bio na terenu, za RAPM procenu igrača.
  const ros = Array.isArray(j.plays) && j.plays.length ? rosterOf(db, g.id) : null;
  if (ros) {
    const list = buildStints(ros, espnPlays(j.plays));
    if (list.length) tx(db, () => saveStints(db, g.id, g.date, list));
  }
  return true;
}

export interface Injury {
  pid: number; name: string; status: string; reason: string;
  /** Kada je objavljeno, procena povratka i stranica igrača na ESPN-u. */
  reported: string | null; expected: string | null; url: string | null;
  source?: 'NBA' | 'ESPN';
}

export async function injuries(): Promise<Map<number, Injury[]>> {
  const j = await getJson(`${SITE}/injuries`);
  const out = new Map<number, Injury[]>();
  for (const t of j?.injuries ?? []) {
    const list: Injury[] = [];
    for (const i of t.injuries ?? []) {
      const href: string = i.athlete?.links?.[0]?.href ?? '';
      const pid = n(href.match(/\/id\/(\d+)/)?.[1]);
      if (!pid) continue;
      list.push({
        pid, name: i.athlete.displayName, status: i.status, reason: injuryReason(i.details?.type, i.details?.side, i.details?.detail),
        reported: i.date ?? null, expected: i.details?.returnDate ?? null, url: espnUrl(href), source: 'ESPN',
      });
    }
    out.set(n(t.id), list);
  }
  return out;
}

/** Aktuelni sastav tima (hvata trejdove i nova pojačanja). */
export async function roster(db: DB, teamId: number): Promise<number[]> {
  const j = await getJson(`${SITE}/teams/${teamId}/roster`);
  const ids: number[] = [];
  const ins = db.prepare('INSERT INTO players(pid,name,dob) VALUES(?,?,?) ON CONFLICT(pid) DO UPDATE SET name=excluded.name, dob=excluded.dob');
  for (const a of j?.athletes ?? []) {
    ids.push(n(a.id));
    ins.run(n(a.id), a.displayName, a.dateOfBirth?.slice(0, 10) ?? null);
  }
  return ids;
}

const PROVIDERS = ['draftkings', 'espn bet', 'consensus', 'caesars sportsbook', 'pinnacle', 'westgate', 'unibet', 'caesars', 'betonline',
  'bovada', 'sugarhouse', 'mgm', 'williamhill', 'titanbets', '5dimes', 'teamrankings', 'numberfire'];

/** Istorijska početna i završna kvota jednog meča. */
export async function historicalOdds(db: DB, gid: number): Promise<boolean> {
  const j = await getJson(`${CORE}/events/${gid}/competitions/${gid}/odds?limit=50`, { rps: 8 });
  const items = (j?.items ?? []).filter((i: any) => !/live/i.test(i.provider?.name ?? ''));
  const parsed = items.map((i: any) => {
    const h = i.homeTeamOdds ?? {}, a = i.awayTeamOdds ?? {};
    const name = String(i.provider?.name ?? '').toLowerCase();
    const mlhC = american(h.close?.moneyLine?.american) ?? american(h.moneyLine);
    const mlaC = american(a.close?.moneyLine?.american) ?? american(a.moneyLine);
    const mlhO = american(h.open?.moneyLine?.american), mlaO = american(a.open?.moneyLine?.american);
    const rank = PROVIDERS.findIndex((p) => name.startsWith(p));
    const okC = noVig(mlhC, mlaC) !== null, okO = noVig(mlhO, mlaO) !== null;
    return {
      name, rank: rank < 0 ? 99 : rank,
      mlhC: okC ? mlhC : null, mlaC: okC ? mlaC : null, mlhO: okO ? mlhO : null, mlaO: okO ? mlaO : null,
      spC: line(h.close?.pointSpread?.american) ?? line(i.spread), spO: line(h.open?.pointSpread?.american),
      toC: line(i.close?.total?.american) ?? line(i.overUnder), toO: line(i.open?.total?.american),
    };
  });
  parsed.sort((x: any, y: any) => Number(y.mlhC !== null) - Number(x.mlhC !== null)
    || Number(y.mlhO !== null) - Number(x.mlhO !== null) || x.rank - y.rank);
  const b = parsed[0];
  const op = parsed.find((x: any) => x.name === 'opening');
  db.prepare('INSERT OR REPLACE INTO odds VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    gid, b?.name ?? null, b?.mlhO ?? op?.mlhC ?? null, b?.mlaO ?? op?.mlaC ?? null, b?.mlhC ?? null, b?.mlaC ?? null,
    b?.spO ?? null, b?.spC ?? null, b?.toO ?? null, b?.toC ?? null, new Date().toISOString());
  return !!b?.mlhC;
}
