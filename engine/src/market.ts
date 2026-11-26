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

/** Istaknut izbor: model je siguran, a kvota je bolja nego što ta šansa zaslužuje. */
export const SURE = 0.7;
export const GOOD_EV = 0.05;
export const isHighlight = (p: number, odds: number | null): boolean => !!odds && p >= SURE && ev(p, odds) >= GOOD_EV;

/** Deo budžeta za ulog: četvrtina Kelly formule, najviše 3%. Nula kad je kvota manja od poštene. */
export function kelly(p: number, odds: number): number {
  return Math.max(0, Math.min(0.03, (ev(p, odds) / (odds - 1)) * 0.25));
}
/** Ulog u dinarima, zaokružen na 10; ispod 20 dinara se ne predlaže. */
export function stakeRsd(p: number, odds: number, budget: number): number {
  const s = Math.round((kelly(p, odds) * budget) / 10) * 10;
  return s >= 20 ? s : 0;
}
