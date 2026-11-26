import type { DB } from '../db.ts';
import { getMeta, setMeta } from '../db.ts';
import { FIRST_SEASON, FIRST_ODDS_SEASON, currentSeason } from '../config.ts';
import { ingestSeason } from '../sources/sportsdataverse.ts';
import { historicalOdds } from '../sources/espn.ts';

/** Završene sezone se preuzimaju jednom, tekuća svaki put. */
export async function ingestAll(db: DB): Promise<void> {
  const cur = currentSeason();
  for (let s = FIRST_SEASON; s <= cur; s++) {
    if (s < cur && getMeta(db, `ingest:${s}`) === 'done') continue;
    const r = await ingestSeason(db, s);
    console.log(`Sezona ${s - 1}/${String(s).slice(2)}:`, r ? `${r.games} mečeva, ${r.players} nastupa` : 'nema podataka');
    if (r && s < cur) setMeta(db, `ingest:${s}`, 'done');
  }
}

/** Dopunjava istorijske kvote za mečeve koji ih još nemaju (prvi put traje oko pola sata). */
export async function backfillOdds(db: DB, limit = Infinity): Promise<void> {
  const ids = (db.prepare(`SELECT g.id FROM games g LEFT JOIN odds o ON o.game_id=g.id
    WHERE o.game_id IS NULL AND g.final=1 AND g.season>=? ORDER BY g.date DESC`).all(FIRST_ODDS_SEASON) as { id: number }[])
    .map((r) => r.id).slice(0, limit === Infinity ? undefined : limit);
  if (!ids.length) return;
  if (ids.length > 50) console.log(`Preuzimam kvote za ${ids.length} mečeva...`);
  let next = 0, done = 0, ok = 0, fail = 0;
  const worker = async () => {
    while (next < ids.length && fail < 60) {
      const id = ids[next++];
      try {
        if (await historicalOdds(db, id)) ok++;
      } catch {
        fail++;
      }
      if (++done % 1000 === 0) console.log(`  ${done} obrađeno, sa kvotom ${ok}, greške ${fail}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`Kvote: ${ok}/${done}, greške ${fail}`);
}
