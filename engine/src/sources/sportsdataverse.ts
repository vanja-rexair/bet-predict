import type { DB } from '../db.ts';
import { tx } from '../db.ts';
import { isNbaTeam } from '../teams.ts';
import { getText } from './http.ts';
import { parseCsv } from './csv.ts';

const BASE = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download';
const num = (s: string) => {
  const v = Number(s);
  return s === '' || s === 'NA' || !Number.isFinite(v) ? 0 : v;
};
const truthy = (s: string) => /^true$/i.test(s);

/** Učitava celu sezonu (box score timova i igrača) iz otvorenog skupa sportsdataverse. */
export async function ingestSeason(db: DB, season: number): Promise<{ games: number; players: number } | null> {
  const teamCsv = await getText(`${BASE}/espn_nba_team_boxscores/team_box_${season}.csv`);
  const playerCsv = await getText(`${BASE}/espn_nba_player_boxscores/player_box_${season}.csv`);
  const schedCsv = await getText(`${BASE}/espn_nba_schedules/nba_schedule_${season}.csv`);
  if (!teamCsv || !playerCsv) return null;

  const neutral = new Map<number, number>();
  const start = new Map<number, string>();
  if (schedCsv) {
    for (const [id, neu, date] of parseCsv(schedCsv, ['id', 'neutral_site', 'date'])) {
      neutral.set(Number(id), truthy(neu) ? 1 : 0);
      start.set(Number(id), date);
    }
  }
  const insG = db.prepare(`INSERT INTO games(id,season,stype,date,start,home,away,hs,as_,final,neutral) VALUES(?,?,?,?,?,?,?,?,?,1,?)
    ON CONFLICT(id) DO UPDATE SET hs=excluded.hs, as_=excluded.as_, final=1, neutral=excluded.neutral, stype=excluded.stype, date=excluded.date`);
  const insT = db.prepare('INSERT OR REPLACE INTO team_box VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const insP = db.prepare('INSERT OR REPLACE INTO player_box VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const insN = db.prepare('INSERT INTO players(pid,name) VALUES(?,?) ON CONFLICT(pid) DO UPDATE SET name=excluded.name');
  let games = 0, players = 0;

  tx(db, () => {
    const known = new Set<number>();
    const teamCols = ['game_id', 'season', 'season_type', 'game_date', 'game_date_time', 'team_id', 'opponent_team_id', 'team_home_away',
      'team_score', 'opponent_team_score', 'field_goals_made', 'field_goals_attempted', 'three_point_field_goals_made',
      'three_point_field_goals_attempted', 'free_throws_made', 'free_throws_attempted', 'offensive_rebounds', 'defensive_rebounds',
      'total_turnovers', 'turnovers', 'assists', 'steals', 'blocks', 'fouls'];
    for (const r of parseCsv(teamCsv, teamCols)) {
      const gid = Number(r[0]), st = Number(r[2]), tid = Number(r[5]), oid = Number(r[6]);
      // Samo regularna sezona, plej-of i plej-in između 30 NBA timova (bez All-Star i pripremnih).
      if (!isNbaTeam(tid) || !isNbaTeam(oid) || ![2, 3, 5].includes(st)) continue;
      const pts = num(r[8]), opp = num(r[9]), fga = num(r[11]);
      if (pts < 50 || opp < 50 || fga < 40) continue;
      if (r[7] === 'home') {
        insG.run(gid, season, st, r[3], start.get(gid) ?? r[4], tid, oid, pts, opp, neutral.get(gid) ?? 0);
        games++;
      }
      known.add(gid);
      insT.run(gid, tid, pts, num(r[10]), fga, num(r[12]), num(r[13]), num(r[14]), num(r[15]), num(r[16]), num(r[17]),
        Math.max(num(r[18]), num(r[19])), num(r[20]), num(r[21]), num(r[22]), num(r[23]));
    }
    const names = new Map<number, string>();
    const playerCols = ['game_id', 'team_id', 'athlete_id', 'athlete_display_name', 'minutes', 'field_goals_made', 'field_goals_attempted',
      'three_point_field_goals_made', 'free_throws_made', 'free_throws_attempted', 'offensive_rebounds', 'defensive_rebounds', 'assists',
      'steals', 'blocks', 'turnovers', 'fouls', 'plus_minus', 'points', 'starter', 'did_not_play'];
    for (const r of parseCsv(playerCsv, playerCols)) {
      const gid = Number(r[0]), pid = Number(r[2]), min = num(r[4]);
      if (!known.has(gid) || !(min > 0) || truthy(r[20]) || !pid) continue;
      insP.run(gid, Number(r[1]), pid, min, num(r[5]), num(r[6]), num(r[7]), num(r[8]), num(r[9]), num(r[10]), num(r[11]), num(r[12]),
        num(r[13]), num(r[14]), num(r[15]), num(r[16]), num(r[17].replace('+', '')), num(r[18]), truthy(r[19]) ? 1 : 0);
      names.set(pid, r[3]);
      players++;
    }
    for (const [pid, name] of names) insN.run(pid, name);
  });
  return { games, players };
}
