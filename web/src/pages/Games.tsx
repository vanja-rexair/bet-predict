import { useMemo, useState } from 'react';
import type { GameView, HistoryRow, Stats } from '../../../engine/src/types.ts';
import { getBudget, refreshServer, useData } from '../api.ts';
import { int, localDay, longDay, num, plural, time } from '../format.ts';
import { GameCard } from '../components/GameCard.tsx';
import { Empty, LevelTable, levelRows, Loading, RecordStrip, Segmented } from '../components/ui.tsx';

type Scope = 'live' | 'season' | 'all';

export function Games() {
  const { data, error, reload } = useData<{ generatedAt: string; games: GameView[] }>('today.json', 45_000);
  const stats = useData<Stats>('stats.json', 300_000).data;
  const hist = useData<{ rows: HistoryRow[] }>('history.json', 300_000).data;
  const [scope, setScope] = useState<Scope>('season');
  const [busy, setBusy] = useState(false);
  const days = useMemo(() => {
    const m = new Map<string, GameView[]>();
    for (const g of data?.games ?? []) {
      const k = localDay(g.start);
      m.set(k, [...(m.get(k) ?? []), g]);
    }
    return [...m.values()];
  }, [data]);
  const refresh = async () => {
    setBusy(true);
    await refreshServer();
    reload();
    setTimeout(() => { reload(); setBusy(false); }, 20_000);
  };
  const levels = useMemo(() => {
    if (scope === 'all') return stats ? levelRows(stats.buckets.map((b) => ({ c: Number.parseInt(b.label) / 100, hit: false, n: b.n, hits: b.hit }))) : null;
    if (!hist) return null;
    return levelRows(hist.rows.filter((r) => scope === 'season' || r.src === 'live').map((r) => ({ c: Math.max(r.p, 1 - r.p), hit: r.hit })));
  }, [scope, stats, hist]);
  const rec = stats && (scope === 'live' ? stats.live : scope === 'season' ? stats.season : stats.overall);
  return (
    <>
      {stats?.staking && !stats.betProven && (
        <p className="note gap">Predlozi uloga su za budžet od {int(getBudget())} din (menja se u podešavanjima). U simulaciji su svakih 100 uloženih dinara {stats.staking.roi < 0 ? 'izgubila' : 'donela'} {num(Math.abs(stats.staking.roi) * 100)} din, pa ih zasad prati na papiru.</p>
      )}
      {rec && (
        <div className="record-wrap">
          <Segmented label="Period" value={scope} onChange={setScope} options={[['live', 'Uživo'], ['season', 'Ova sezona'], ['all', 'Od 2018/19']]} />
          <div className="record-row">
            <div><RecordStrip r={rec} /></div>
            {levels && <LevelTable rows={levels} />}
          </div>
          <p className="hint">{scope === 'live'
            ? 'Samo predikcije zaključane pre početka meča, od puštanja aplikacije.'
            : 'Simulacija: za svaki meč model je koristio samo podatke od pre tog meča.'}</p>
        </div>
      )}
      <div className="bar-row">
        <span className="muted">{data ? `Ažurirano u ${time(data.generatedAt)}` : ''}{error && data ? ', nema veze sa servisom' : ''}</span>
        <button type="button" className="btn" onClick={refresh} disabled={busy}>{busy ? 'Proveravam…' : 'Proveri sada'}</button>
      </div>
      {!data ? <Loading error={error} /> : !days.length ? <Empty>Nema zakazanih mečeva u naredna dva dana.</Empty> : days.map((list) => (
        <section key={localDay(list[0].start)} className="day">
          <h2>{longDay(list[0].start)} <span className="muted">{list.length} {plural(list.length, 'meč', 'meča', 'mečeva')}</span></h2>
          <div className="grid-cards">{list.map((g) => <GameCard key={g.id} g={g} past={stats?.highlight ?? null} proven={stats?.betProven ?? false} />)}</div>
        </section>
      ))}
    </>
  );
}
