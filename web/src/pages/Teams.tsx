import { useMemo, useState } from 'react';
import type { TeamRow } from '../../../engine/src/types.ts';
import { useData } from '../api.ts';
import { num, pct, signed } from '../format.ts';
import { Loading, Section } from '../components/ui.tsx';

type Key = 'net' | 'elo' | 'off' | 'def' | 'pace' | 'efg' | 'tov' | 'orb' | 'ftr' | 'w' | 'acc';
const COLS: [Key, string, string, (t: TeamRow) => string, boolean][] = [
  ['w', 'Skor', 'Pobede i porazi', (t) => `${t.w}–${t.l}`, false],
  ['net', 'NetRtg', 'Razlika poena na 100 poseda, prilagođena protivnicima', (t) => signed(t.net), false],
  ['off', 'OffRtg', 'Poeni na 100 poseda', (t) => num(t.off), false],
  ['def', 'DefRtg', 'Primljeni poeni na 100 poseda (manje je bolje)', (t) => num(t.def), true],
  ['elo', 'Elo', 'Elo rejting', (t) => num(t.elo, 0), false],
  ['pace', 'Pace', 'Poseda na 48 minuta', (t) => num(t.pace), false],
  ['efg', 'eFG%', 'Efektivni procenat šuta', (t) => pct(t.efg, 1), false],
  ['tov', 'TOV%', 'Izgubljene lopte po posedu (manje je bolje)', (t) => pct(t.tov, 1), true],
  ['orb', 'OREB%', 'Skok u napadu', (t) => pct(t.orb, 1), false],
  ['ftr', 'FT Rate', 'Slobodna bacanja po šutu iz igre', (t) => num(t.ftr, 2), false],
  ['acc', 'Pogođeno', 'Uspešnost predikcija u mečevima ovog tima', (t) => (t.picks ? pct(t.hit / t.picks) : '–'), false],
];
const val = (t: TeamRow, k: Key) => (k === 'acc' ? (t.picks ? t.hit / t.picks : 0) : k === 'w' ? t.w / Math.max(1, t.w + t.l) : t[k]);

export function Teams() {
  const { data, error } = useData<{ rows: TeamRow[] }>('teams.json', 300_000);
  const [sort, setSort] = useState<{ k: Key; asc: boolean }>({ k: 'net', asc: false });
  const rows = useMemo(() => [...(data?.rows ?? [])].sort((a, b) => (val(a, sort.k) - val(b, sort.k)) * (sort.asc ? 1 : -1)), [data, sort]);
  if (!data) return <Loading error={error} />;
  return (
    <Section title="Snaga timova" hint="Vrednosti su trenutna procena modela (noviji mečevi vrede više), pa se razlikuju od zvaničnog proseka sezone.">
      <div className="table-wrap">
        <table>
          <thead><tr><th className="sticky">Tim</th>{COLS.map(([k, label, title, , asc]) => (
            <th key={k} className="r" aria-sort={sort.k === k ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
              <button type="button" title={title} onClick={() => setSort(sort.k === k ? { k, asc: !sort.asc } : { k, asc })}>{label}{sort.k === k ? (sort.asc ? ' ↑' : ' ↓') : ''}</button>
            </th>
          ))}</tr></thead>
          <tbody>{rows.map((t) => <tr key={t.id}><th scope="row" className="sticky">{t.name}</th>{COLS.map(([k, , , f]) => <td key={k} className="r">{f(t)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </Section>
  );
}
