import type { Pregame, PlayerBox, TeamBox } from './features.ts';
import type { Postmortem } from '../types.ts';

/** Vrednost poseda u poenima, koristi se za prevođenje lopti i skokova u poene. */
const PPP = 1.1;

export interface PmInput {
  pickHome: boolean; hs: number; as: number; pre: Pregame; hb: TeamBox; ab: TeamBox; ps: PlayerBox[];
  homeId: number; awayId: number; pickName: string; name: (pid: number) => string;
}

/** Analizira zašto je izabrani tim izgubio: koliko je poena odneo svaki faktor u odnosu na očekivanje. */
export function postmortem(i: PmInput): Postmortem {
  const { pre } = i;
  const own = i.pickHome ? i.hb : i.ab, opp = i.pickHome ? i.ab : i.hb;
  const ps = i.pickHome ? pre.home : pre.away, os = i.pickHome ? pre.away : pre.home;
  const li = i.pickHome ? pre.h : pre.a;
  const pickId = i.pickHome ? i.homeId : i.awayId;
  const margin = (i.hs - i.as) * (i.pickHome ? 1 : -1);

  const own3 = (own.tpm - ps.p3 * own.tpa) * 3;
  const opp3 = (os.p3 * opp.tpa - opp.tpm) * 3;
  const ft = own.ftm - 0.78 * own.fta - (opp.ftm - 0.78 * opp.fta);
  const n = pre.pace;
  const tov = ((opp.tov - own.tov) - (os.tov - ps.tov) * n) * PPP;
  const expOrb = (s: number, miss: number) => s * miss;
  const ownMiss = own.fga - own.fgm, oppMiss = opp.fga - opp.fgm;
  const orb = (own.orb - expOrb(ps.orb, ownMiss) - (opp.orb - expOrb(os.orb, oppMiss))) * PPP;
  const ftr = ((own.fta - ps.ftr * own.fga) - (opp.fta - os.ftr * opp.fga)) * 0.6;
  const two = (b: TeamBox) => (b.fgm - b.tpm) / Math.max(1, b.fga - b.tpa);
  const exp2 = 0.535;
  const inside = ((two(own) - exp2) * (own.fga - own.tpa) - (two(opp) - exp2) * (opp.fga - opp.tpa)) * 2;

  // Ključni igrač koji je odigrao mnogo manje od očekivanog (povreda u meču, faulovi, odmor).
  const early: string[] = [];
  for (const k of li.key) {
    const p = i.ps.find((q) => q.team_id === pickId && q.pid === k.pid);
    if (!p || p.min < k.min * 0.55) early.push(i.name(k.pid));
  }
  const missing = li.out.filter((o) => o.prob < 0.4 && o.min >= 22 && o.impact > 1).map((o) => i.name(o.pid));

  const all = [
    { label: 'Trojke izabranog tima (u odnosu na njihov prosek)', points: own3, cat: 'Promašene trojke' },
    { label: 'Trojke protivnika (u odnosu na njihov prosek)', points: opp3, cat: 'Protivnik pogađao trojke' },
    { label: 'Realizacija slobodnih bacanja', points: ft, cat: 'Slobodna bacanja' },
    { label: 'Izgubljene lopte', points: tov, cat: 'Izgubljene lopte' },
    { label: 'Skok u napadu', points: orb, cat: 'Skok' },
    { label: 'Iznuđivanje faulova', points: ftr, cat: 'Faulovi' },
    { label: 'Šut za dva poena', points: inside, cat: 'Šut za dva i odbrana reketa' },
  ].sort((a, b) => a.points - b.points);
  const luck = own3 + opp3 + ft;
  const worst = all[0];

  const close = Math.abs(margin) <= 3;
  const flips = margin - luck > 0;
  let category = worst.cat;
  let nature: Postmortem['nature'] = 'greška';
  if (early.length) { category = 'Ključni igrač igrao manje'; nature = 'varijansa'; }
  else if (flips) { category = 'Nesreća u šutu'; nature = 'varijansa'; }
  else if (close) { category = 'Tesna završnica'; nature = 'varijansa'; }
  else if (missing.length) category = 'Oslabljen sastav';
  else if (ps.b2b && inside + own3 < -4) category = 'Zamor (B2B)';

  const f = (v: number) => Math.abs(v).toFixed(0);
  const parts: string[] = [`${i.pickName}: poraz sa ${f(margin)} razlike.`];
  if (early.length) parts.push(`${early.join(', ')} na terenu mnogo kraće od očekivanog.`);
  if (missing.length) parts.push(`Bez igrača: ${missing.join(', ')}.`);
  if (flips) parts.push(`Bez odstupanja u trojkama i slobodnim bacanjima (${f(luck)} poena na štetu) izabrani tim bi pobedio.`);
  else parts.push(`Najveći gubitak: ${worst.label.toLowerCase()} (oko ${f(worst.points)} poena ispod očekivanog).`);
  if (ps.b2b) parts.push('Tim je igrao drugi meč u dva dana.');
  if (nature === 'greška') parts.push('Računa se kao greška procene: rejtinzi i korekcije su pomereni.');
  else parts.push('Uglavnom slučajnost: jedan ovakav meč ne menja mnogo procenu tima.');
  return { nature, category, summary: parts.join(' '), factors: all.slice(0, 4).filter((a) => a.points < -1.5).map(({ label, points }) => ({ label, points })) };
}
