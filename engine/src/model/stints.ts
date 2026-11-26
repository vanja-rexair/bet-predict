import type { DB } from '../db.ts';

/** Jedna akcija iz zapisa poen po poen, u obliku zajedničkom za ESPN i otvoreni skup. */
export interface Play {
  period: number; order: number; type: string; shooting: boolean;
  /** Učesnici akcije; kod izmene prvi ulazi, a drugi izlazi. */
  ids: number[]; hs: number; as: number;
}
/** Deonica: isti igrači na terenu od jedne do sledeće izmene. */
export interface Stint { h: number[]; a: number[]; poss: number; m: number }
export interface GameRoster { home: number; away: number; team: Map<number, number>; starters: Set<number> }

const TOV = /Turnover|Traveling|Bad Pass|Lost Ball|Shot Clock/;

/**
 * Rekonstruiše ko je bio na terenu. Na početku četvrtine to su igrači koji se pojave pre
 * nego što uđu sa klupe; ko celu četvrtinu nema nijednu akciju, preuzima se iz kraja prethodne.
 * Četvrtina u kojoj se ne dobije tačno 5 na 5 se preskače.
 */
export function buildStints(r: GameRoster, plays: Play[]): Stint[] {
  plays.sort((a, b) => a.period - b.period || a.order - b.order);
  const sides = [r.home, r.away];
  let prevEnd = new Map(sides.map((t) => [t, new Set([...r.starters].filter((p) => r.team.get(p) === t))]));
  const out: Stint[] = [];
  let lastH = 0, lastA = 0;
  for (const per of [...new Set(plays.map((p) => p.period))]) {
    const pl = plays.filter((p) => p.period === per);
    const start = new Map(sides.map((t) => [t, new Set<number>()])), cameIn = new Set<number>();
    for (const p of pl) {
      const sub = p.type === 'Substitution';
      for (const id of sub ? p.ids.slice(1, 2) : p.ids) {
        const t = r.team.get(id);
        if (t !== undefined && !cameIn.has(id)) start.get(t)!.add(id);
      }
      if (sub && p.ids[0]) cameIn.add(p.ids[0]);
    }
    let ok = true;
    for (const t of sides) {
      const s = start.get(t)!;
      for (const id of prevEnd.get(t) ?? []) if (s.size < 5 && !cameIn.has(id)) s.add(id);
      if (s.size !== 5) ok = false;
    }
    const on = new Map(sides.map((t) => [t, new Set(start.get(t))]));
    let seg = { h: lastH, a: lastA, fga: 0, orb: 0, tov: 0, fta: 0 };
    const close = () => {
      const poss = (seg.fga - seg.orb + seg.tov + 0.44 * seg.fta) / 2;
      const m = lastH - seg.h - (lastA - seg.a);
      if (ok && on.get(r.home)!.size === 5 && on.get(r.away)!.size === 5 && (poss > 0 || m !== 0)) {
        out.push({ h: [...on.get(r.home)!], a: [...on.get(r.away)!], poss: Math.max(poss, 0.5), m });
      }
      seg = { h: lastH, a: lastA, fga: 0, orb: 0, tov: 0, fta: 0 };
    };
    for (const p of pl) {
      if (p.type === 'Substitution') {
        close();
        const [inn, outp] = p.ids;
        const t = r.team.get(inn) ?? r.team.get(outp);
        if (t !== undefined && inn && outp) { on.get(t)!.delete(outp); on.get(t)!.add(inn); }
      } else {
        if (/Free Throw/.test(p.type)) seg.fta++;
        else if (p.shooting) seg.fga++;
        if (p.type === 'Offensive Rebound') seg.orb++;
        if (TOV.test(p.type)) seg.tov++;
      }
      if (Number.isFinite(p.hs) && Number.isFinite(p.as)) { lastH = p.hs; lastA = p.as; }
    }
    close();
    prevEnd = on;
  }
  return out;
}

/** Sastav meča iz box score-a: kom timu pripada igrač i ko je počeo meč. */
export function rosterOf(db: DB, gameId: number): GameRoster | null {
  const g = db.prepare('SELECT home, away FROM games WHERE id=?').get(gameId) as { home: number; away: number } | undefined;
  if (!g) return null;
  const rows = db.prepare('SELECT pid, team_id, starter FROM player_box WHERE game_id=?').all(gameId) as { pid: number; team_id: number; starter: number }[];
  if (!rows.length) return null;
  return { home: g.home, away: g.away, team: new Map(rows.map((x) => [x.pid, x.team_id])), starters: new Set(rows.filter((x) => x.starter).map((x) => x.pid)) };
}

export function saveStints(db: DB, gameId: number, date: string, list: Stint[]): void {
  db.prepare('DELETE FROM stints WHERE game_id=?').run(gameId);
  const ins = db.prepare('INSERT INTO stints VALUES(?,?,?,?,?,?,?)');
  list.forEach((s, i) => ins.run(gameId, i, date, JSON.stringify(s.h), JSON.stringify(s.a), s.poss, s.m));
}

/** Akcije iz ESPN izveštaja posle meča. */
export function espnPlays(plays: any[]): Play[] {
  return plays.map((p, i) => ({
    period: Number(p.period?.number ?? 0), order: Number(p.sequenceNumber ?? i) || i, type: String(p.type?.text ?? ''), shooting: !!p.shootingPlay,
    ids: (p.participants ?? []).map((x: any) => Number(x.athlete?.id)).filter((x: number) => x > 0), hs: Number(p.homeScore), as: Number(p.awayScore),
  }));
}
