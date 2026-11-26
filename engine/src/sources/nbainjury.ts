import { TEAMS } from '../teams.ts';
import type { Injury } from './espn.ts';
import { BODY_KEYS, detailSr, injuryReason } from '../model/injury.ts';

/**
 * Zvanični NBA izveštaj o povredama (PDF, nova verzija na svakih 15 minuta).
 * Tačniji i brži od ESPN-a: sadrži odmore, G ligu i odluke objavljene pred meč.
 * Ako NBA promeni izgled dokumenta, ovde se menjaju kolone (COLS) i prepoznavanje redova.
 */
const BASE = 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_';

export interface OfficialEntry { date: string; teamId: number; name: string; status: string; reason: string }
export interface OfficialReport {
  /** Vreme izveštaja (ET, npr. "2026-11-25 06:15PM") i adresa PDF-a. */
  at: string; time: string; url: string;
  entries: OfficialEntry[];
  /** Timovi čiji izveštaj još nije predat, po datumu meča. */
  pending: { date: string; teamId: number }[];
}

// Leva ivica svake kolone u PDF-u (tačke). Tekst ide u kolonu čija je ivica najbliža sleva.
const COLS = [['date', 0], ['time', 110], ['matchup', 190], ['team', 255], ['player', 415], ['status', 575], ['reason', 655]] as const;
type Col = (typeof COLS)[number][0];
const colOf = (x: number): Col => {
  let c: Col = 'date';
  for (const [name, left] of COLS) if (x >= left) c = name;
  return c;
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const TEAM_BY_NAME = new Map([...TEAMS.values()].map((t) => [norm(t.name), t.id]));
TEAM_BY_NAME.set(norm('Los Angeles Clippers'), [...TEAMS.values()].find((t) => t.abbr === 'LAC')!.id);

/** Ime igrača za poređenje: "Jackson Jr., Jaren" i "Jaren Jackson Jr." daju isto. */
export function playerKey(name: string): string {
  const [last, first] = name.includes(',') ? name.split(',', 2) : ['', name];
  return norm(`${first} ${last}`).split(' ').filter((w) => w && !['jr', 'sr', 'ii', 'iii', 'iv', 'v'].includes(w)).join(' ');
}

const STATUS = new Set(['Out', 'Doubtful', 'Questionable', 'Probable', 'Available']);
const OTHER: Record<string, string> = {
  'g league - two-way': 'G liga (dvojni ugovor)', 'g league - on assignment': 'poslat u G ligu', 'rest': 'odmor', 'personal reasons': 'lični razlozi',
  'not with team': 'nije sa timom', 'league suspension': 'suspenzija', 'suspension': 'suspenzija', 'team suspension': 'suspenzija tima',
  'health and safety protocols': 'zdravstveni protokol', 'concussion protocol': 'protokol za potres mozga',
};
const SIDES = ['left', 'right', 'bilateral'];

/** Razlog na srpskom; nepoznat izraz ostaje kako ga NBA piše. */
export function officialReason(raw: string): string {
  const r = raw.replace(/\s+/g, ' ').trim();
  const low = r.toLowerCase();
  if (OTHER[low]) return OTHER[low];
  const m = r.match(/^Injury\/Illness\s*-\s*(.+)$/i);
  if (!m) return r;
  // Oblik je "strana, deo tela, dijagnoza", npr. "Right Achilles Tendon Rupture / Tear".
  const words = m[1].replace(/;/g, ' ').replaceAll('/', ' / ').split(' ').filter(Boolean);
  const side = SIDES.includes(words[0]?.toLowerCase()) ? words.shift()! : '';
  const whole = words.join(' ').toLowerCase();
  if (/^(gastrointestinal )?illness$/.test(whole)) return whole === 'illness' ? 'bolest' : 'stomačne tegobe';
  // Najduži poznati deo tela na početku; ostatak je dijagnoza.
  const known = new Set(BODY_KEYS());
  let n = 0;
  for (let k = Math.min(4, words.length); k >= 1 && !n; k--) if (known.has(words.slice(0, k).join(' ').toLowerCase())) n = k;
  if (!n) { const d = detailSr(words.join(' ')); return d && d !== whole ? d : `povreda (${words.join(' ')})`; }
  const base = injuryReason(words.slice(0, n).join(' '), side, '');
  const detail = detailSr(words.slice(n).join(' '));
  return detail ? `${base}, ${detail}` : base;
}

interface Item { x: number; y: number; s: string }

/** Pretvara stranice PDF-a u spisak igrača po timu i datumu meča. */
export function parseReport(pages: Item[][]): Pick<OfficialReport, 'entries' | 'pending'> {
  const entries: (OfficialEntry & { y: number; page: number; reasonParts: { y: number; s: string }[] })[] = [];
  const pending: { date: string; teamId: number }[] = [];
  let date = '', teamId = 0;
  pages.forEach((items, page) => {
    // Redovi po visini; tekst u ćeliji koja se prelama u dva reda ima svoju visinu.
    const lines = new Map<number, Item[]>();
    for (const it of items) {
      if (!it.s.trim()) continue;
      const y = Math.round(it.y);
      const key = [...lines.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      lines.set(key, [...(lines.get(key) ?? []), it]);
    }
    const pageEntries: typeof entries = [];
    const loose: { y: number; s: string }[] = [];
    for (const [y, list] of [...lines].sort((a, b) => b[0] - a[0])) {
      const cell: Partial<Record<Col, string>> = {};
      for (const it of list.sort((a, b) => a.x - b.x)) {
        const c = colOf(it.x);
        // Reč prelomljena crticom ("Two-" "Way", "Karl-" "Anthony") spaja se bez razmaka.
        const prev = cell[c];
        cell[c] = !prev ? it.s.trim() : /\S-$/.test(prev) ? `${prev}${it.s.trim()}` : `${prev} ${it.s.trim()}`;
      }
      if (cell.date?.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
        const [mm, dd, yyyy] = cell.date.split('/');
        date = `${yyyy}-${mm}-${dd}`;
      }
      if (cell.team && /[a-z]/.test(cell.team) && !/^Team$/.test(cell.team)) {
        const id = TEAM_BY_NAME.get(norm(cell.team));
        if (id) teamId = id;
      }
      if (/NOT YET SUBMITTED/i.test(Object.values(cell).join(' '))) {
        if (teamId && date) pending.push({ date, teamId });
        continue;
      }
      const status = cell.status && STATUS.has(cell.status) ? cell.status : '';
      if (cell.player && status && teamId && date) {
        const e = { date, teamId, name: cell.player, status, reason: '', y, page, reasonParts: [] as { y: number; s: string }[] };
        if (cell.reason) e.reasonParts.push({ y, s: cell.reason });
        pageEntries.push(e);
      } else if (cell.reason && !cell.player) loose.push({ y, s: cell.reason });
    }
    // Razlog prelomljen u dva reda stoji iznad i ispod reda igrača: pripada najbližem igraču.
    for (const l of loose) {
      let best: (typeof entries)[number] | undefined;
      for (const e of pageEntries) if (!best || Math.abs(e.y - l.y) < Math.abs(best.y - l.y)) best = e;
      if (best && Math.abs(best.y - l.y) <= 20) best.reasonParts.push(l);
    }
    entries.push(...pageEntries);
  });
  return {
    entries: entries.map(({ y: _y, page: _p, reasonParts, ...e }) => ({
      ...e, reason: officialReason(reasonParts.sort((a, b) => b.y - a.y).map((p) => p.s).join(' ')),
    })),
    pending,
  };
}

/** Vreme izveštaja u ET, zaokruženo naniže na 15 minuta, i koraci unazad. */
function slots(now: Date, back: number): { at: string; time: string; file: string }[] {
  const out: { at: string; time: string; file: string }[] = [];
  for (let i = 0; i < back; i++) {
    const d = new Date(Math.floor(now.getTime() / 900000) * 900000 - i * 900000);
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true })
      .formatToParts(d).map((x) => [x.type, x.value]));
    const hh = p.hour === '24' ? '12' : p.hour;
    out.push({ time: d.toISOString(), at: `${p.year}-${p.month}-${p.day} ${hh}:${p.minute}${p.dayPeriod.toUpperCase()}`, file: `${p.year}-${p.month}-${p.day}_${hh}_${p.minute}${p.dayPeriod.toUpperCase()}` });
  }
  return out;
}

export async function readPdf(data: Uint8Array): Promise<Item[][]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data, useSystemFonts: false, verbosity: 0 }).promise;
  const pages: Item[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(tc.items.filter((it) => 'str' in it).map((it: any) => ({ x: it.transform[4], y: it.transform[5], s: it.str })));
  }
  await doc.cleanup?.();
  return pages;
}

/** Najnoviji zvanični izveštaj iz poslednja 3 sata; null ako ga nema (dan bez mečeva ili NBA ne odgovara). */
export async function officialReport(now = new Date()): Promise<OfficialReport | null> {
  for (const s of slots(now, 12)) {
    const url = `${BASE}${s.file}.pdf`;
    let res: Response;
    try { res = await fetch(url, { signal: AbortSignal.timeout(20000) }); } catch { continue; }
    // Izveštaj koji još ne postoji vraća 403 ili 404.
    if (!res.ok) continue;
    const pages = await readPdf(new Uint8Array(await res.arrayBuffer()));
    return { at: s.at, time: s.time, url, ...parseReport(pages) };
  }
  return null;
}

/**
 * Spisak povređenih za jedan tim na jedan meč: zvanični NBA izveštaj ima prednost nad ESPN-om.
 * Kad su svi igrači iz zvaničnog izveštaja prepoznati, ESPN unos koji NBA ne navodi otpada (igrač igra).
 * Ako neko ime nije prepoznato, ESPN spisak ostaje kao rezerva, a NBA statusi ga samo dopunjuju.
 */
export function mergeOfficial(espn: Injury[], report: OfficialReport | null, teamId: number, date: string,
  candidates: number[], nm: (pid: number) => string, warn: (s: string) => void = () => {}): Injury[] {
  if (!report || report.pending.some((p) => p.teamId === teamId && p.date === date)) return espn;
  const list = report.entries.filter((e) => e.teamId === teamId && e.date === date);
  if (!list.length) return espn;
  const byKey = new Map<string, number>();
  for (const pid of candidates) byKey.set(playerKey(nm(pid)), pid);
  const byPid = new Map(espn.map((i) => [i.pid, i]));
  const official = new Map<number, Injury>();
  let missed = 0;
  for (const e of list) {
    const pid = byKey.get(playerKey(e.name));
    if (pid === undefined) { missed++; warn(`NBA izveštaj: nije prepoznat igrač "${e.name}"`); continue; }
    const old = byPid.get(pid);
    official.set(pid, { pid, name: old?.name ?? nm(pid), status: e.status, reason: e.reason, reported: report.time, expected: old?.expected ?? null, url: report.url, source: 'NBA' });
  }
  const rest = espn.filter((i) => !official.has(i.pid) && missed > 0);
  return [...official.values(), ...rest];
}
