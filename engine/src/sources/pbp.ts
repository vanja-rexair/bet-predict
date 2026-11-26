import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type { DB } from '../db.ts';
import { tx } from '../db.ts';
import { buildStints, rosterOf, saveStints, type Play } from '../model/stints.ts';
import { request } from './http.ts';

const BASE = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_pbp';
const COLS = ['game_id', 'game_play_number', 'period_number', 'type_text', 'shooting_play', 'athlete_id_1', 'athlete_id_2', 'athlete_id_3', 'home_score', 'away_score'];

/** Zapis poen po poen cele sezone iz otvorenog skupa; upisuje deonice za mečeve koji ih nemaju. */
export async function ingestPbpSeason(db: DB, season: number, onlyMissing = true): Promise<number | null> {
  const res = await request(`${BASE}/play_by_play_${season}.parquet`, { timeout: 300000 });
  if (!res) return null;
  const buf = await res.arrayBuffer();
  const rows = await parquetReadObjects({ file: buf, compressors, columns: COLS });
  const by = new Map<number, Play[]>();
  for (const r of rows as any[]) {
    const gid = Number(r.game_id);
    let l = by.get(gid);
    if (!l) by.set(gid, (l = []));
    l.push({
      period: Number(r.period_number), order: Number(r.game_play_number), type: String(r.type_text ?? ''), shooting: !!r.shooting_play,
      ids: [r.athlete_id_1, r.athlete_id_2, r.athlete_id_3].filter((x) => x != null).map(Number), hs: Number(r.home_score), as: Number(r.away_score),
    });
  }
  const have = new Set((db.prepare('SELECT DISTINCT game_id g FROM stints').all() as { g: number }[]).map((r) => r.g));
  const date = db.prepare('SELECT date FROM games WHERE id=? AND final=1');
  let n = 0;
  tx(db, () => {
    for (const [gid, plays] of by) {
      if (onlyMissing && have.has(gid)) continue;
      const d = (date.get(gid) as { date: string } | undefined)?.date, ros = rosterOf(db, gid);
      if (!d || !ros) continue;
      const list = buildStints(ros, plays);
      if (list.length) { saveStints(db, gid, d, list); n++; }
    }
  });
  return n;
}
