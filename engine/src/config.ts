import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = process.env.BP_DATA_DIR ?? path.join(ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'nba.sqlite');
/** JSON koji čitaju web i Android aplikacija. */
export const PUBLIC_DIR = path.join(DATA_DIR, 'public');
/** Trajni zapis pravih (pre meča zaključanih) predikcija; preživljava brisanje baze. */
export const STATE_DIR = process.env.BP_STATE_DIR ?? path.join(ROOT, 'state');
export const WEB_DIST = path.join(ROOT, 'web/dist');

/** Sezona se označava godinom završetka (2027 = 2026/27). */
export const FIRST_SEASON = 2014;       // samo zagrevanje rejtinga
export const FIRST_TRAIN_SEASON = 2015; // prvi mečevi u treningu
export const FIRST_BACKTEST_SEASON = 2019;
export const FIRST_ODDS_SEASON = 2018;

/** Povećati kad se promeni skup karakteristika ili algoritam (poništava keš backtesta). */
export const MODEL_VERSION = 3;

/** Datum po njujorškom vremenu (tako NBA vodi raspored). */
export function etDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}
export function currentSeason(d: Date = new Date()): number {
  const [y, m] = etDate(d).split('-').map(Number);
  return m >= 9 ? y + 1 : y;
}
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}
