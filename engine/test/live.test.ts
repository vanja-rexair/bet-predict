import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'));
process.env.BP_DATA_DIR = path.join(dir, 'data');
process.env.BP_STATE_DIR = path.join(dir, 'state');

const { openDb, setMeta } = await import('../src/db.ts');
const { addDays, etDate } = await import('../src/config.ts');
const { update, newCtx } = await import('../src/pipeline/update.ts');

/** Lažni ESPN: jedan meč (tim 1 protiv tima 2) čije stanje test menja. */
const world = {
  state: 'pre', completed: false, hs: 0, as: 0, period: 0, clock: '0:00', mlh: '-150', mla: '+130',
  start: new Date(Date.now() + 3600e3).toISOString(), injured: false,
};
const pid = (t: number, p: number) => t * 100 + p;
const board = () => ({
  events: [{
    id: '999', date: world.start, season: { year: 2027, type: 2 },
    status: { type: { state: world.state, completed: world.completed, name: 'X' }, period: world.period, displayClock: world.clock },
    competitions: [{
      neutralSite: false, venue: { fullName: 'Dvorana' },
      competitors: [{ homeAway: 'home', team: { id: '1' }, score: String(world.hs) }, { homeAway: 'away', team: { id: '2' }, score: String(world.as) }],
      odds: [{ provider: { name: 'DraftKings' }, spread: -3, overUnder: 220,
        moneyline: { home: { open: { odds: '-150' }, close: { odds: world.mlh } }, away: { open: { odds: '+130' }, close: { odds: world.mla } } } }],
    }],
  }],
});
const summary = () => ({
  boxscore: {
    teams: ['1', '2'].map((id) => ({ team: { id }, statistics: Object.entries({
      'fieldGoalsMade-fieldGoalsAttempted': '38-88', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted': id === '1' ? '4-32' : '18-32',
      'freeThrowsMade-freeThrowsAttempted': '16-20', offensiveRebounds: '10', defensiveRebounds: '34', totalTurnovers: '13', assists: '20', steals: '7', blocks: '4', fouls: '19',
    }).map(([name, displayValue]) => ({ name, displayValue })) })),
    players: [1, 2].map((t) => ({ team: { id: String(t) }, statistics: [{
      keys: ['minutes', 'points', 'fieldGoalsMade-fieldGoalsAttempted', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted',
        'rebounds', 'assists', 'turnovers', 'steals', 'blocks', 'offensiveRebounds', 'defensiveRebounds', 'fouls', 'plusMinus'],
      athletes: Array.from({ length: 10 }, (_, p) => ({ athlete: { id: String(pid(t, p)), displayName: `Igrač ${t}-${p}` }, starter: p < 5, didNotPlay: false,
        stats: ['24', '10', '4-9', '1-3', '2-2', '4', '2', '1', '1', '0', '1', '3', '2', '-3'] })),
    }] })),
  },
});
let boardDay = etDate(new Date(world.start));
globalThis.fetch = (async (url: string) => {
  const u = String(url);
  let body: unknown = {};
  if (u.includes('/scoreboard')) body = u.includes(boardDay.replaceAll('-', '')) ? board() : { events: [] };
  else if (u.includes('/summary')) body = summary();
  else if (u.includes('/injuries')) {
    body = { injuries: [{ id: '1', injuries: world.injured ? [{ status: 'Out', athlete: { displayName: 'Igrač 1-0', links: [{ href: 'https://x/player/_/id/100/a' }] }, details: { type: 'Knee' } }] : [] }] };
  } else if (u.includes('/roster')) {
    const t = Number(u.match(/teams\/(\d+)/)![1]);
    body = { athletes: Array.from({ length: 10 }, (_, p) => ({ id: String(pid(t, p)), displayName: `Igrač ${t}-${p}`, dateOfBirth: '1998-01-01T00:00Z' })) };
  }
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

function seed(db: ReturnType<typeof openDb>): void {
  const insG = db.prepare('INSERT INTO games(id,season,stype,date,start,home,away,hs,as_,final,neutral) VALUES(?,2027,2,?,?,?,?,?,?,1,0)');
  const insT = db.prepare('INSERT INTO team_box VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const insP = db.prepare('INSERT INTO player_box VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 80; i++) {
    const home = 1 + (i % 4), away = 1 + ((i + 1 + (i % 3)) % 4);
    if (home === away) continue;
    const date = addDays(etDate(), -82 + i), hs = 100 + ((i * 7) % 17) + (home === 1 ? 8 : 0), as = 105;
    insG.run(i + 1, date, date, home, away, hs === as ? hs + 1 : hs, as);
    for (const [t, pts] of [[home, hs], [away, as]]) {
      insT.run(i + 1, t, pts, 40, 86, 12, 33, 18, 22, 10, 33, 13, 24, 8, 5, 20);
      for (let p = 0; p < 10; p++) insP.run(i + 1, t, pid(t, p), p < 5 ? 32 : 16, 5, 10, 1, 2, 2, 1, 3, 2, 1, 0, 1, 2, 0, p === 0 ? 30 : 10, p < 5 ? 1 : 0);
    }
  }
  setMeta(db, 'catchup', etDate());
}

test('ceo tok meča: procena, povreda, kvota, zaključavanje, uživo, ishod i analiza', async () => {
  const db = openDb();
  seed(db);
  const ctx = newCtx();
  const quiet = () => {};
  const row = () => JSON.parse((db.prepare('SELECT payload FROM live WHERE game_id=999').get() as { payload: string }).payload);
  const types = () => (db.prepare('SELECT type FROM events WHERE game_id=999 ORDER BY id').all() as { type: string }[]).map((e) => e.type);

  await update(db, ctx, quiet);
  const first = row();
  assert.equal(first.locked, false);
  assert.ok(first.pHome > 0 && first.pHome < 1);
  assert.deepEqual(types().filter((t) => t === 'prediction'), ['prediction']);

  // Kvota se potpuno okreće, a prognoza se ne pomera ni za dlaku.
  world.mlh = '+400'; world.mla = '-550';
  await update(db, ctx, quiet);
  assert.equal(row().pHome, first.pHome, 'kvote ne smeju da utiču na prognozu');
  assert.deepEqual(row().initial, first.initial);

  world.injured = true; world.mlh = '-250'; world.mla = '+205';
  await update(db, ctx, quiet);
  assert.ok(types().includes('injury'), 'povreda mora da bude zabeležena');
  assert.ok(types().includes('odds'), 'pomeraj kvote mora da bude zabeležen');
  const second = row();
  assert.equal(second.outHome[0].name, 'Igrač 1-0');
  assert.equal(second.created, first.created);
  assert.deepEqual(second.initial, first.initial, 'prva prognoza se nikad ne menja');
  assert.ok(second.odds.home < first.odds.home && second.odds.homeOpen === first.odds.homeOpen);

  // Početak meča: predikcija se zaključava i više ništa ne sme da je promeni.
  world.state = 'in'; world.period = 1; world.clock = '10:00'; world.hs = 5; world.as = 2; world.injured = false; world.mlh = '+900'; world.mla = '-2000';
  await update(db, ctx, quiet);
  const locked = row();
  assert.equal(locked.locked, true);
  assert.equal(locked.pHome, second.pHome);
  assert.deepEqual(locked.odds, second.odds, 'kvote uživo ne smeju da uđu u zapis pre meča');
  assert.ok(Math.abs(locked.clv - (second.firstOddsPick / second.closeOddsPick - 1)) < 1e-9);
  assert.ok(locked.live.winProb > 0);

  world.period = 4; world.clock = '1:00'; world.hs = 80; world.as = 100;
  await update(db, ctx, quiet);
  assert.ok(row().live.winProb < 0.02);
  assert.ok(types().includes('danger') && types().includes('half'));

  world.state = 'post'; world.completed = true; world.hs = 90; world.as = 112;
  await update(db, ctx, quiet);
  const done = row();
  assert.equal(done.pick, 'home');
  assert.deepEqual(done.result, { hs: 90, as: 112, hit: false });
  assert.equal(done.postmortem.category, 'Nesreća u šutu');
  assert.equal(done.pHome, second.pHome);
  assert.ok(types().includes('miss'));

  // Ponovljena provera ne sme ništa da duplira.
  const n = types().length;
  await update(db, ctx, quiet);
  assert.equal(types().length, n);

  const stats = JSON.parse(fs.readFileSync(path.join(process.env.BP_DATA_DIR!, 'public/stats.json'), 'utf8'));
  assert.deepEqual([stats.live.total, stats.live.hit, stats.live.miss, stats.live.pct], [1, 0, 1, 0]);
  assert.ok(!JSON.stringify(JSON.parse(fs.readFileSync(path.join(process.env.BP_DATA_DIR!, 'public/today.json'), 'utf8'))).includes('"pre":{'), 'interni podaci se ne objavljuju');

  const recent = JSON.parse(fs.readFileSync(path.join(process.env.BP_DATA_DIR!, 'public/recent.json'), 'utf8')).rows;
  assert.equal(recent.length, 1);
  assert.equal(recent[0].hit, false);
  assert.deepEqual(recent[0].initial, first.initial);
  assert.equal(recent[0].hs, 90);

  // Zapis preživljava brisanje baze.
  db.exec('DELETE FROM live; DELETE FROM events;');
  await update(db, ctx, quiet);
  assert.equal(row().result.hit, false);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
