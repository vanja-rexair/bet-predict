import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type DB } from '../src/db.ts';
import { addDays } from '../src/config.ts';
import { buildHistory, FEATURES, type League } from '../src/model/features.ts';
import { DESCRIBE } from '../src/model/describe.ts';
import { availability } from '../src/pipeline/update.ts';
import { postmortem } from '../src/model/postmortem.ts';
import { rng } from '../src/ml/metrics.ts';

/** Mala veštačka liga od 4 tima. */
function seed(db: DB, games: number, lastHome?: number): void {
  const r = rng(9);
  const insG = db.prepare('INSERT INTO games(id,season,stype,date,start,home,away,hs,as_,final,neutral) VALUES(?,?,2,?,?,?,?,?,?,1,0)');
  const insT = db.prepare('INSERT INTO team_box VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const insP = db.prepare('INSERT INTO player_box VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < games; i++) {
    const home = 1 + (i % 4), away = 1 + ((i + 1 + (i % 3)) % 4);
    if (home === away) continue;
    const date = addDays('2015-11-01', i);
    const last = i === games - 1;
    const hs = last && lastHome !== undefined ? lastHome : 95 + Math.floor(r() * 25), as = 94;
    const h = hs === as ? hs + 1 : hs;
    insG.run(i + 1, 2016, date, date + 'T00:00Z', home, away, h, as);
    for (const [t, pts] of [[home, h], [away, as]]) {
      insT.run(i + 1, t, pts, Math.round(pts * 0.38), 85, 10, 30, 18, 24, 10, 33, 14, 22, 8, 5, 20);
      for (let p = 0; p < 10; p++) insP.run(i + 1, t, t * 100 + p, 24, 4, 9, 1, 2, 2, 1, 3, 2, 1, 0, 1, 2, t === home ? h - as : as - h, 11 - p, p < 5 ? 1 : 0);
    }
  }
}

test('nema curenja: karakteristike meča ne zavise od njegovog rezultata', () => {
  const a = openDb(':memory:'), b = openDb(':memory:');
  seed(a, 41, 130);
  seed(b, 41, 70);
  const ra = buildHistory(a).rows, rb = buildHistory(b).rows;
  const la = ra[ra.length - 1], lb = rb[rb.length - 1];
  assert.notEqual(la.y, lb.y);
  assert.deepEqual([...la.x], [...lb.x]);
  assert.equal(la.x.length, FEATURES.length);
  assert.ok([...la.x].every((v) => Number.isFinite(v)));
});

test('povreda najboljeg igrača smanjuje snagu sastava, a izbačeni iz sastava se ne računaju', () => {
  const db = openDb(':memory:');
  seed(db, 60);
  const lg: League = buildHistory(db).league;
  const ros = Array.from({ length: 10 }, (_, p) => 100 + p);
  const full = lg.lineup(1, availability(lg, 1, [], ros));
  const hurt = lg.lineup(1, availability(lg, 1, [{ pid: 100, name: 'A', status: 'Out', reason: '', reported: null, expected: null, url: null }], ros));
  assert.ok(hurt.str < full.str);
  assert.ok(hurt.miss > 0);
  assert.equal(hurt.out[0].pid, 100);
  const traded = availability(lg, 1, [], ros.slice(1));
  assert.equal(traded.a.get(100), 0);
});

test('svaki parametar ima opis za stranicu Kako biramo', () => {
  for (const [k] of FEATURES) assert.ok(DESCRIBE[k]?.[0] && DESCRIBE[k]?.[1], k);
  assert.equal(Object.keys(DESCRIBE).length, FEATURES.length);
});

test('zamor: meč narednog dana je B2B', () => {
  const db = openDb(':memory:');
  seed(db, 30);
  const lg = buildHistory(db).league;
  const ix = (n: string) => FEATURES.findIndex(([f]) => f === n);
  const last = lg.team(1).recent.at(-1)!.date;
  const none = { a: new Map<number, number>() };
  const b2b = lg.features({ season: 2016, stype: 2, date: addDays(last, 1), home: 1, away: 2, neutral: 0 }, none, none).x;
  const rested = lg.features({ season: 2016, stype: 2, date: addDays(last, 4), home: 1, away: 2, neutral: 0 }, none, none).x;
  assert.equal(b2b[ix('b2bH')], 1);
  assert.equal(rested[ix('b2bH')], 0);
});

test('analiza promašaja razlikuje nesreću u šutu od greške procene', () => {
  const side = { p3: 0.36, efg: 0.54, tov: 0.13, orb: 0.25, ftr: 0.25, b2b: false, rest: 2, km7: 0, elo: 1500, off: 112, def: 110, pace: 98 };
  const li = { str: 5, miss: 0, missUsg: 0, missMin: 0, star: 5, elo: 0, cont: 1, rapm: 0, out: [], key: [] };
  const pre = { expMargin: 5, expTotal: 220, pace: 98, home: side, away: side, h: li, a: li };
  const box = (o: object) => ({ game_id: 1, team_id: 1, pts: 100, fgm: 40, fga: 88, tpm: 12, tpa: 34, ftm: 16, fta: 20, orb: 10, drb: 34, tov: 13, ast: 24, stl: 7, blk: 5, pf: 20, ...o });
  const base = { pickHome: true, pre, ps: [], homeId: 1, awayId: 2, pickName: 'Domaći', name: String };
  const cold = postmortem({ ...base, hs: 100, as: 108, hb: box({ tpm: 5 }), ab: box({ team_id: 2, tpm: 18 }) });
  assert.equal(cold.nature, 'varijansa');
  const bad = postmortem({ ...base, hs: 90, as: 112, hb: box({ tov: 26 }), ab: box({ team_id: 2, tov: 8 }) });
  assert.equal(bad.nature, 'greška');
  assert.equal(bad.category, 'Izgubljene lopte');
});
