import { useMemo, useState } from 'react';
import type { RecentGame } from '../../../engine/src/types.ts';
import { useData } from '../api.ts';
import { localDay, longDay } from '../format.ts';
import { PastCard } from '../components/PastCard.tsx';
import { Empty, Loading, RecordStrip, Segmented } from '../components/ui.tsx';

type Res = 'all' | 'hit' | 'miss';
/** Simulacija ponekad nema tačno vreme početka, pa se tada koristi datum. */
const when = (g: RecentGame) => (g.start.includes('T') ? g.start : `${g.date}T20:00:00`);

export function Week() {
  const { data, error } = useData<{ rows: RecentGame[] }>('recent.json', 60_000);
  const [res, setRes] = useState<Res>('all');
  const rows = data?.rows ?? [];
  const days = useMemo(() => {
    const m = new Map<string, RecentGame[]>();
    for (const g of rows) if (res === 'all' || g.hit === (res === 'hit')) m.set(localDay(when(g)), [...(m.get(localDay(when(g))) ?? []), g]);
    return [...m.values()];
  }, [rows, res]);
  if (!data) return <Loading error={error} />;
  const hit = rows.filter((r) => r.hit).length;
  const sim = rows.some((r) => r.src === 'test');
  return (
    <>
      <div className="record-wrap">
        <RecordStrip r={{ label: '', total: rows.length, hit, miss: rows.length - hit, pct: rows.length ? hit / rows.length : 0, market: null, logLoss: 0, brier: 0 }} />
        <p className="hint">Boja se određuje prema prvoj prognozi, koja se posle ne menja.{sim && ' Kartice sa oznakom Simulacija su mečevi pre puštanja aplikacije: model ih je predvideo naknadno, samo iz ranijih podataka.'}</p>
        <Segmented label="Ishod" value={res} onChange={setRes} options={[['all', 'Svi'], ['hit', 'Pogođeni'], ['miss', 'Promašeni']]} />
      </div>
      {!days.length ? <Empty>Nema završenih mečeva u poslednjih 7 dana.</Empty> : days.map((list) => (
        <section key={localDay(when(list[0]))} className="day">
          <h2>{longDay(when(list[0]))} <span className="muted">{list.filter((g) => g.hit).length} od {list.length} pogođeno</span></h2>
          <div className="grid-cards">{list.map((g) => <PastCard key={g.id} g={g} />)}</div>
        </section>
      ))}
    </>
  );
}
