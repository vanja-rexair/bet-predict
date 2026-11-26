import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, normCdf, rng, sigmoid } from '../src/ml/metrics.ts';
import { trainGbdt, predictRaw } from '../src/ml/gbdt.ts';
import { trainLinear, linearRaw } from '../src/ml/linear.ts';
import { Elo, Glicko } from '../src/ml/ratings.ts';
import { advise, american, flat, kelly, noVig, stakeRsd } from '../src/market.ts';
import { parseCsv } from '../src/sources/csv.ts';
import { inPlayProb, remaining } from '../src/model/inplay.ts';
import { Gate, Lessons } from '../src/model/lessons.ts';
import { espnUrl, injuryReason } from '../src/model/injury.ts';
import { NF } from '../src/model/features.ts';

test('metrike: log loss, Brier i tačnost', () => {
  const m = evaluate([0.8, 0.3], [1, 0]);
  assert.equal(m.acc, 1);
  assert.ok(Math.abs(m.logLoss - (-Math.log(0.8) - Math.log(0.7)) / 2) < 1e-12);
  assert.ok(Math.abs(m.brier - (0.04 + 0.09) / 2) < 1e-12);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
});

test('stabla uče nelinearnu vezu i podnose vrednosti koje nedostaju', () => {
  const r = rng(1);
  const X: Float64Array[] = [], y: number[] = [];
  for (let i = 0; i < 3000; i++) {
    const a = r() * 2 - 1, b = r() * 2 - 1;
    X.push(Float64Array.from([i % 10 === 0 ? NaN : a, b, r()]));
    y.push(a * b > 0 ? 1 : 0); // XOR: linearni model ovde ne može ništa
  }
  const w = new Float64Array(3000).fill(1), Y = Float64Array.from(y);
  const opts = { rounds: 120, lr: 0.1, depth: 4, colsample: 1 };
  const m = trainGbdt(X.slice(0, 2400), Y.slice(0, 2400), w.slice(0, 2400), opts);
  const acc = evaluate(X.slice(2400).map((x) => sigmoid(predictRaw(m, x))), y.slice(2400)).acc;
  assert.ok(acc > 0.85, `tačnost ${acc}`);
  const m2 = trainGbdt(X.slice(0, 2400), Y.slice(0, 2400), w.slice(0, 2400), opts);
  assert.equal(predictRaw(m, X[5]), predictRaw(m2, X[5]), 'trening mora biti ponovljiv');
});

test('logistička regresija vraća prave koeficijente', () => {
  const r = rng(2);
  const X: Float64Array[] = [], y: number[] = [];
  for (let i = 0; i < 20000; i++) {
    const x = Float64Array.from([r() * 2 - 1, r() * 2 - 1]);
    X.push(x);
    y.push(r() < sigmoid(0.5 + 2 * x[0] - x[1]) ? 1 : 0);
  }
  const m = trainLinear(X, y, new Array(y.length).fill(1), 'logistic', 0.1, { standardize: false });
  assert.ok(Math.abs(m.coef[0] - 2) < 0.15 && Math.abs(m.coef[1] + 1) < 0.15 && Math.abs(m.intercept - 0.5) < 0.1);
  assert.ok(Number.isFinite(linearRaw(m, [NaN, 1])));
});

test('Elo i Glicko: zbir Elo poena je očuvan, pobednik raste, nesigurnost pada', () => {
  const e = new Elo();
  e.update(1, 2, 110, 100, false);
  assert.ok(Math.abs(e.get(1) + e.get(2) - 2900) < 1e-9);
  assert.ok(e.get(1) > e.get(2));
  const g = new Glicko();
  g.update(1, 2, true, false);
  assert.ok(g.get(1).r > 1500 && g.get(2).r < 1500 && g.get(1).rd < 200);
});

test('kvote: konverzija, marža i ulog', () => {
  assert.equal(american('+150'), 2.5);
  assert.equal(american(-200), 1.5);
  assert.equal(american('EVEN'), 2);
  assert.equal(american(0), null);
  assert.equal(noVig(1.91, 1.91), 0.5);
  assert.equal(noVig(1.5, 10), null, 'neispravan par se odbacuje');
  assert.equal(kelly(0.4, 2), 0);
  assert.ok(kelly(0.9, 3) <= 0.03);
  assert.equal(stakeRsd(0.85, 1.1, 10000), 0, 'kvota 1,10 je manja od poštene 1,18');
  assert.equal(stakeRsd(0.7, 1.5, 10000), 250);
});

test('isplativost: 93 od 100 na kvotu 1,08 je blagi plus, a na 1,06 minus', () => {
  const at = (odds: number) => flat(Array.from({ length: 100 }, (_, i) => ({ hit: i < 93, odds })));
  assert.ok(Math.abs(at(1.08).roi - 0.0044) < 1e-9);
  assert.ok(Math.abs(at(1.06).roi + 0.0142) < 1e-9);
  assert.equal(flat([{ hit: true, odds: null }]).n, 0);
});

test('CSV: navodnici, zarezi i prelomi u polju', () => {
  const rows = [...parseCsv('a,b,c\n1,"x, ""y""\nz",3\r\n4,,6\n', ['c', 'b', 'nema'])];
  assert.deepEqual(rows, [['3', 'x, "y"\nz', ''], ['6', '', '']]);
});

test('uživo verovatnoća je razumna', () => {
  assert.equal(remaining(1, '12:00'), 1);
  assert.equal(remaining(4, '0:00'), 0);
  assert.equal(remaining(5, '5:00'), 5 / 48);
  assert.ok(inPlayProb(20, 0.1, 0, 12.5) > 0.97);
  assert.ok(inPlayProb(0, 1, 5, 12.5) > 0.6);
  assert.equal(inPlayProb(3, 0, -9, 12.5), 0.999);
});

test('korekcija po situaciji se uvodi tek kad je greška statistički značajna', () => {
  const x = new Float64Array(NF);
  const small = new Lessons(), biased = new Lessons();
  for (let i = 0; i < 50; i++) small.learn(x, 0.4, 1, 1, 2);
  assert.ok(small.list().every((l) => !l.active));
  for (let i = 0; i < 1000; i++) biased.learn(x, 0.4, i % 2, 1, 2); // gost favorit 60%, a dobija samo 50%
  const l = biased.list().find((s) => s.key === 'fav_away')!;
  assert.ok(l.active && l.adjust < 0);
  assert.ok(biased.segment(x, 0.4) > 0, 'korekcija ide u korist domaćina');
});

test('razlog povrede je na srpskom, a nepoznat izraz se ne nagađa', () => {
  assert.equal(injuryReason('Knee', 'Right', 'Inflammation'), 'povreda desnog kolena, upala');
  assert.equal(injuryReason('Hamstring', 'Left', 'Strain'), 'povreda leve zadnje lože, istegnuće');
  assert.equal(injuryReason('Illness'), 'bolest');
  assert.equal(injuryReason('Back', 'Left', 'Not Specified'), 'povreda leđa');
  assert.equal(injuryReason('Xyz', 'Left'), 'povreda (Xyz)');
  assert.equal(injuryReason(), 'razlog nije objavljen');
  assert.equal(espnUrl('javascript:alert(1)'), null);
  assert.equal(espnUrl('https://evil.example/espn.com/'), null);
});

test('mehanizam korekcije se gasi ako ne pomaže', () => {
  const bad = new Gate(), good = new Gate();
  for (let i = 0; i < 700; i++) { bad.add(0.6, 0.4, 1); good.add(0.6, 0.7, 1); }
  assert.equal(bad.active, false);
  assert.equal(good.active, true);
});

test('linearni model podnosi konstantnu karakteristiku i posle čuvanja u JSON', () => {
  const X = Array.from({ length: 100 }, (_, i) => Float64Array.from([0.1 + (i % 2) * 1e-17, i % 5]));
  const y = X.map((_, i) => i % 5);
  const m = trainLinear(X, y, new Array(100).fill(1), 'ridge', 0.01);
  const saved = JSON.parse(JSON.stringify(m)) as typeof m;
  assert.ok(Math.abs(linearRaw(saved, [5, 2]) - 2) < 0.05);
});

test('preporuka: igra se samo kad je šansa bar 40% i bar 5% bolja od kvote', () => {
  assert.equal(advise(0.6, null).play, false);
  const fav = advise(0.6, { home: 1.8, away: 2.1 }); // 0,6 × 1,8 = 1,08
  assert.equal(fav.play, true);
  assert.equal(fav.side, 'home');
  assert.ok(Math.abs(fav.ev! - 0.08) < 1e-9);
  const low = advise(0.6, { home: 1.6, away: 2.5 }); // 0,96 i 0,4 × 2,5 = 1,0
  assert.equal(low.play, false);
  assert.equal(low.side, 'home');
  const dog = advise(0.55, { home: 1.3, away: 3.6 }); // gost 45% × 3,6 = 1,62
  assert.equal(dog.play, true);
  assert.equal(dog.side, 'away');
  assert.match(dog.reason, /Autsajder/);
  assert.equal(advise(0.7, { home: 1.2, away: 5 }).play, false); // gost 30% je ispod 40%
});

test('deonice: izmene igrača prave nove deonice, a zbir razlika je konačan rezultat', async () => {
  const { buildStints } = await import('../src/model/stints.ts');
  const H = [1, 2, 3, 4, 5, 6], A = [11, 12, 13, 14, 15];
  const team = new Map<number, number>([...H.map((p) => [p, 100] as [number, number]), ...A.map((p) => [p, 200] as [number, number])]);
  const r = { home: 100, away: 200, team, starters: new Set([1, 2, 3, 4, 5, 11, 12, 13, 14, 15]) };
  const pl = (order: number, type: string, ids: number[], hs: number, as: number, shooting = false) => ({ period: 1, order, type, ids, hs, as, shooting });
  const list = buildStints(r, [
    pl(1, 'Jump Shot', [1], 2, 0, true), pl(2, 'Jump Shot', [11], 2, 3, true),
    pl(3, 'Substitution', [6, 1], 2, 3), pl(4, 'Layup', [6], 4, 3, true), pl(5, 'Jump Shot', [12], 4, 5, true),
  ]);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0].h.sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(list[1].h.sort(), [2, 3, 4, 5, 6]);
  assert.equal(list.reduce((s, x) => s + x.m, 0), 4 - 5);
});

test('RAPM: igrač sa kojim tim dobija deonice dobija veću procenu', async () => {
  const { fitRapm } = await import('../src/ml/rapm.ts');
  const rows = [];
  for (let i = 0; i < 400; i++) {
    const star = i % 2 === 0;
    rows.push({ t: 0, h: star ? [1, 2, 3, 4, 5] : [6, 2, 3, 4, 5], a: [11, 12, 13, 14, 15], poss: 10, m: star ? 3 : -1 });
  }
  const r = fitRapm(rows, 0);
  assert.ok(r.get(1)! > r.get(6)!);
});
