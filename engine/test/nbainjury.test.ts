import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOfficial, officialReason, parseReport, playerKey, type OfficialReport } from '../src/sources/nbainjury.ts';
import type { Injury } from '../src/sources/espn.ts';

test('NBA razlog se prevodi na srpski', () => {
  assert.equal(officialReason('Injury/Illness - Left Hamstring Strain'), 'povreda leve zadnje lože, istegnuće');
  assert.equal(officialReason('Injury/Illness - Right Achilles Tendon Rupture / Tear'), 'povreda desne Ahilove tetive, ruptura, pucanje');
  assert.equal(officialReason('G League - Two-Way'), 'G liga (dvojni ugovor)');
  assert.equal(officialReason('Rest'), 'odmor');
  assert.equal(officialReason('Injury/Illness - Illness'), 'bolest');
});

test('ime iz NBA izveštaja odgovara ESPN imenu', () => {
  assert.equal(playerKey('Jackson Jr., Jaren'), playerKey('Jaren Jackson Jr.'));
  assert.equal(playerKey('Doncic, Luka'), playerKey('Luka Dončić'));
  assert.equal(playerKey('Towns, Karl-Anthony'), playerKey('Karl-Anthony Towns'));
});

// Kolone kao u pravom PDF-u: datum 24, vreme 121, meč 201, tim 265, igrač 426, status 587, razlog 667.
const it = (x: number, y: number, s: string) => ({ x, y, s });
const page = [
  it(23, 480, 'Game'), it(425, 480, 'Player'), it(586, 480, 'Current'), it(666, 480, 'Reason'),
  it(24, 459, '11/25/2026'), it(121, 459, '07:30'), it(201, 459, 'CLE@NYK'), it(265, 459, 'Cleveland'), it(307, 459, 'Cavaliers'),
  it(426, 459, 'Mobley,'), it(462, 459, 'Evan'), it(587, 459, 'Out'), it(667, 459, 'Injury/Illness'), it(722, 459, '-'), it(727, 459, 'Left'), it(745, 459, 'Great'), it(770, 459, 'Toe'), it(788, 459, 'Sprain'),
  // Razlog prelomljen u dva reda, iznad i ispod imena.
  it(426, 387, 'Tomlin,'), it(459, 387, "Nae'Qwan"), it(587, 387, 'Out'), it(667, 394, 'Injury/Illness'), it(722, 394, '-'), it(727, 394, 'Low'), it(746, 394, 'Back'), it(767, 394, 'Stress'), it(667, 380, 'Reaction'),
  it(265, 360, 'New'), it(290, 360, 'York'), it(315, 360, 'Knicks'), it(426, 360, 'Towns,'), it(460, 360, 'Karl-'), it(486, 360, 'Anthony'), it(587, 360, 'Probable'),
  it(667, 360, 'Injury/Illness'), it(722, 360, '-'), it(727, 360, 'Right'), it(750, 360, 'Knee'), it(775, 360, 'Inflammation'),
];

test('PDF stranica se čita po kolonama', () => {
  const r = parseReport([page]);
  assert.deepEqual(r.entries.map((e) => [e.date, e.teamId, e.name, e.status, e.reason]), [
    ['2026-11-25', 5, 'Mobley, Evan', 'Out', 'povreda levog palca stopala, uganuće'],
    ['2026-11-25', 5, "Tomlin, Nae'Qwan", 'Out', 'povreda donjeg dela leđa, stres reakcija'],
    ['2026-11-25', 18, 'Towns, Karl-Anthony', 'Probable', 'povreda desnog kolena, upala'],
  ]);
});

test('zvanični status ima prednost nad ESPN-om', () => {
  const names = new Map([[1, 'Evan Mobley'], [2, 'Darius Garland'], [3, 'Max Strus']]);
  const nm = (pid: number) => names.get(pid)!;
  const espn: Injury[] = [
    { pid: 1, name: 'Evan Mobley', status: 'Day-To-Day', reason: 'x', reported: null, expected: '2026-12-01', url: null, source: 'ESPN' },
    { pid: 2, name: 'Darius Garland', status: 'Day-To-Day', reason: 'y', reported: null, expected: null, url: null, source: 'ESPN' },
  ];
  const report: OfficialReport = { at: '', time: 't', url: 'u', pending: [], entries: [{ date: '2026-11-25', teamId: 5, name: 'Mobley, Evan', status: 'Out', reason: 'r' }] };
  const m = mergeOfficial(espn, report, 5, '2026-11-25', [1, 2, 3], nm);
  // Garland nije na zvaničnom izveštaju, znači igra.
  assert.deepEqual(m.map((i) => [i.pid, i.status, i.source, i.expected]), [[1, 'Out', 'NBA', '2026-12-01']]);
  // Drugi datum ili tim koji još nije predao izveštaj: ostaje ESPN.
  assert.equal(mergeOfficial(espn, report, 5, '2026-11-26', [1, 2, 3], nm), espn);
  assert.equal(mergeOfficial(espn, { ...report, pending: [{ date: '2026-11-25', teamId: 5 }] }, 5, '2026-11-25', [1, 2, 3], nm), espn);
  // Neprepoznato ime: ESPN spisak ostaje kao rezerva.
  const odd = { ...report, entries: [...report.entries, { date: '2026-11-25', teamId: 5, name: 'Nepoznat, Igrac', status: 'Out', reason: '' }] };
  assert.equal(mergeOfficial(espn, odd, 5, '2026-11-25', [1, 2, 3], nm).length, 2);
});
