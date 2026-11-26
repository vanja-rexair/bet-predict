import { useMemo, useState } from 'react';
import type { HistoryRow } from '../../../engine/src/types.ts';
import { useData } from '../api.ts';
import { odds, pct, shortDate } from '../format.ts';
import { Empty, Loading, RecordStrip, Segmented, Verdict } from '../components/ui.tsx';

type Src = 'all' | 'live' | 'test';
type Res = 'all' | 'hit' | 'miss';

export function History() {
  const { data, error } = useData<{ rows: HistoryRow[] }>('history.json', 300_000);
  const [src, setSrc] = useState<Src>('all');
  const [res, setRes] = useState<Res>('all');
  const [min, setMin] = useState(50);
  const [team, setTeam] = useState('');
  const [limit, setLimit] = useState(60);
  const teams = useMemo(() => [...new Set((data?.rows ?? []).flatMap((r) => [r.home, r.away]))].sort(), [data]);
  // Filter po ishodu ne sme da menja uspešnost, zato se računa pre njega.
  const base = useMemo(() => (data?.rows ?? []).filter((r) => (src === 'all' || r.src === src) && Math.max(r.p, 1 - r.p) * 100 >= min && (!team || r.home === team || r.away === team)), [data, src, min, team]);
  const rows = base.filter((r) => res === 'all' || r.hit === (res === 'hit'));
  if (!data) return <Loading error={error} />;
  const hit = base.filter((r) => r.hit).length;
  return (
    <>
      <div className="filters">
        <Segmented label="Izvor" value={src} onChange={setSrc} options={[['all', 'Sve'], ['live', 'Uživo'], ['test', 'Simulacija']]} />
        <Segmented label="Ishod" value={res} onChange={setRes} options={[['all', 'Svi'], ['hit', 'Pogođeni'], ['miss', 'Promašeni']]} />
        <label className="field">Najmanja sigurnost
          <select value={min} onChange={(e) => setMin(Number(e.target.value))}>{[50, 55, 60, 65, 70, 75, 80, 85].map((v) => <option key={v} value={v}>{v}%</option>)}</select>
        </label>
        <label className="field">Tim
          <select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">Svi</option>{teams.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
      </div>
      <RecordStrip r={{ label: '', total: base.length, hit, miss: base.length - hit, pct: base.length ? hit / base.length : 0, market: null, logLoss: 0, brier: 0 }} />
      {!rows.length ? <Empty>Nema mečeva za izabrane filtere.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Datum</th><th>Meč</th><th className="r">Rezultat</th><th>Izbor</th><th className="r">Šansa</th><th className="r">Kvota</th><th>Ishod</th><th>Izvor</th></tr></thead>
            <tbody>
              {rows.slice(0, limit).map((r) => (
                <tr key={r.id}>
                  <td>{shortDate(r.date)}</td><td>{r.away} @ {r.home}</td><td className="r">{r.as} : {r.hs}</td><td>{r.pick === 'home' ? r.home : r.away}</td>
                  <td className="r">{pct(Math.max(r.p, 1 - r.p))}</td><td className="r">{odds(r.odds)}</td><td><Verdict hit={r.hit} /></td><td className="muted">{r.src === 'live' ? 'Uživo' : 'Simulacija'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit && <button type="button" className="btn center" onClick={() => setLimit(limit + 100)}>Prikaži još</button>}
    </>
  );
}
