import type { GameView } from '../../engine/src/types.ts';

const L = 'sr-Latn-RS';
export const pct = (v: number, d = 0) => `${(v * 100).toLocaleString(L, { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
export const num = (v: number, d = 1) => v.toLocaleString(L, { minimumFractionDigits: d, maximumFractionDigits: d });
export const signed = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), d)}`;
export const int = (v: number) => v.toLocaleString(L);
export const odds = (v: number | null | undefined) => (v ? num(v, 2) : '–');
export const time = (iso: string) => new Date(iso).toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit' });
export const dayTime = (iso: string) => new Date(iso).toLocaleString(L, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
export const longDay = (iso: string) => {
  const s = new Date(iso).toLocaleDateString(L, { weekday: 'long', day: 'numeric', month: 'long' });
  return s[0].toUpperCase() + s.slice(1);
};
/** Datum NBA rasporeda (YYYY-MM-DD) bez pomeranja vremenske zone. */
export const shortDate = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return `${dd}. ${m}. ${y}.`; };
export const localDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA');

export const pickTeam = (g: GameView) => (g.pick === 'home' ? g.home : g.away);
export function confidenceLabel(c: number): string {
  if (c >= 0.8) return 'Veoma sigurno';
  if (c >= 0.7) return 'Sigurno';
  if (c >= 0.6) return 'Umereno';
  return 'Neizvesno';
}
export type Level = 'top' | 'sure' | 'mid' | 'low';
export const level = (c: number): Level => (c >= 0.8 ? 'top' : c >= 0.7 ? 'sure' : c >= 0.6 ? 'mid' : 'low');
export function quarter(p: number, clock: string): string {
  if (p > 4) return `Produžetak ${p - 4}, ${clock}`;
  return `${p}. četvrtina, ${clock}`;
}
/** Srpska množina: 1 meč, 2 meča, 5 mečeva. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
