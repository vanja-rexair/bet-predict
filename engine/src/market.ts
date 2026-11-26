import type { Advice } from './types.ts';

/** Američka kvota -> decimalna. */
export function american(ml: number | string | null | undefined): number | null {
  if (ml === null || ml === undefined || ml === '') return null;
  const v = typeof ml === 'number' ? ml : /^even$/i.test(ml) ? 100 : Number(ml.replace('+', ''));
  if (!Number.isFinite(v) || Math.abs(v) < 100) return null;
  return v > 0 ? 1 + v / 100 : 1 + 100 / -v;
}

/** Implicirana verovatnoća domaćina (1/kvota) očišćena od marže kladionice. */
export function noVig(h: number | null | undefined, a: number | null | undefined): number | null {
  if (!h || !a || h <= 1 || a <= 1) return null;
  const ih = 1 / h, ia = 1 / a, s = ih + ia;
  if (s < 0.98 || s > 1.15) return null; // neispravan par kvota
  return ih / s;
}

/** Očekivana vrednost po uloženoj jedinici. */
export const ev = (p: number, odds: number) => p * odds - 1;

/** Prosečna kvota i povraćaj kad je na svaki izbor isti ulog. */
export function flat(rows: { hit: boolean; odds?: number | null }[]): { n: number; hit: number; odds: number; roi: number } {
  const l = rows.filter((r) => r.odds), won = l.filter((r) => r.hit);
  const sum = (q: typeof l) => q.reduce((s, r) => s + r.odds!, 0);
  return { n: l.length, hit: won.length, odds: l.length ? sum(l) / l.length : 0, roi: l.length ? sum(won) / l.length - 1 : 0 };
}

/** Istaknut izbor: model je siguran, a kvota je bolja nego što ta šansa zaslužuje. */
export const SURE = 0.7;
export const GOOD_EV = 0.05;
export const isHighlight = (p: number, odds: number | null): boolean => !!odds && p >= SURE && ev(p, odds) >= GOOD_EV;

/** Najmanja naša šansa za koju se preporučuje opklada (i na autsajdera). */
export const MIN_P = 0.4;
const pc = (v: number) => `${Math.round(v * 100)}%`;
const od2 = (v: number) => v.toFixed(2).replace('.', ',');

/**
 * Preporuka da li igrati meč. Ko je favorit odlučuje samo statistika; kvota se koristi
 * jedino da se vidi da li se opklada isplati: naša šansa mora biti bar 5% bolja od kvote.
 */
export function advise(pHome: number, o: { home: number; away: number } | null): Advice {
  const pick = pHome >= 0.5 ? 'home' as const : 'away' as const;
  const pp = Math.max(pHome, 1 - pHome);
  if (!o) return { play: false, side: pick, odds: null, p: pp, ev: null, reason: 'Kvote još nisu objavljene.' };
  let best: Advice | null = null;
  for (const side of ['home', 'away'] as const) {
    const p = side === 'home' ? pHome : 1 - pHome, od = o[side], e = ev(p, od);
    if (p >= MIN_P && e >= GOOD_EV && (!best || e > best.ev!)) {
      best = { play: true, side, odds: od, p, ev: e, reason: side === pick
        ? `Naša šansa ${pc(p)}, a kvota ${od2(od)} traži samo ${pc(1 / od)}.`
        : `Autsajder: po analizi ima ${pc(p)} šanse, a kvota ${od2(od)} traži samo ${pc(1 / od)}.` };
    }
  }
  if (best) return best;
  const od = o[pick], e = ev(pp, od);
  return { play: false, side: pick, odds: od, p: pp, ev: e, reason: e < 0
    ? `Kvota ${od2(od)} traži ${pc(1 / od)}, a naša šansa je ${pc(pp)}.`
    : `Prednost od ${pc(e)} je premala; treba bar ${pc(GOOD_EV)} (kvota ${od2(od)}).` };
}

/** Deo budžeta za ulog: četvrtina Kelly formule, najviše 3%. Nula kad je kvota manja od poštene. */
export function kelly(p: number, odds: number): number {
  return Math.max(0, Math.min(0.03, (ev(p, odds) / (odds - 1)) * 0.25));
}
/** Ulog u dinarima, zaokružen na 10; ispod 20 dinara se ne predlaže. */
export function stakeRsd(p: number, odds: number, budget: number): number {
  const s = Math.round((kelly(p, odds) * budget) / 10) * 10;
  return s >= 20 ? s : 0;
}
