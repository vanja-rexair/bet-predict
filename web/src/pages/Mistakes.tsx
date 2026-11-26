import { useState } from 'react';
import type { Miss, Stats } from '../../../engine/src/types.ts';
import { useData } from '../api.ts';
import { int, num, pct, shortDate, signed } from '../format.ts';
import { Bars } from '../components/charts.tsx';
import { Empty, Loading, Section, Segmented } from '../components/ui.tsx';

type Kind = 'all' | 'greška' | 'varijansa';

export function Mistakes() {
  const { data, error } = useData<{ rows: Miss[] }>('misses.json', 300_000);
  const s = useData<Stats>('stats.json', 300_000).data;
  const [kind, setKind] = useState<Kind>('all');
  const [limit, setLimit] = useState(15);
  if (!data || !s) return <Loading error={error} />;
  const rows = data.rows.filter((r) => kind === 'all' || r.pm.nature === kind);
  return (
    <>
      <Section title="Zašto model promašuje" hint={`Analizirano je ${int(s.missTotal)} promašaja od 2018/19. U ${pct(s.varianceShare)} slučajeva procena je da je presudila slučajnost: šut koji odstupa od proseka, tesna završnica ili povreda u meču.`}>
        <Bars rows={s.missCategories.map((c) => ({ label: c.category, value: c.n, text: `${int(c.n)} (${pct(c.share)})` }))} />
      </Section>
      <Section title="Naučene lekcije" hint="Za svaku situaciju poredi se koliko je favorit trebalo da pobeđuje i koliko je zaista pobeđivao. Korekcija se uvodi samo kad je razlika statistički značajna (najmanje 200 mečeva i |z| od 2).">
        <p className="note">
          {s.lessonGate.active
            ? `Korekcije po situacijama su uključene: log loss ${num(s.lessonGate.after, 4)} umesto ${num(s.lessonGate.before, 4)}.`
            : `Korekcije po situacijama su trenutno isključene jer na ranijim mečevima ne poboljšavaju predikciju (log loss ${num(s.lessonGate.after, 4)} prema ${num(s.lessonGate.before, 4)}).`}{' '}
          {s.teamGate.active ? 'Korekcije po timovima su uključene.' : 'Korekcije po timovima su isključene iz istog razloga.'}{' '}
          Osnovni model svejedno uči iz svakog meča: menja rejtinge, efikasnost i ocene igrača, i redovno se ponovo trenira.
        </p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Situacija</th><th className="r">Mečeva</th><th className="r">Očekivano</th><th className="r">Stvarno</th><th className="r">z</th><th>Stanje</th></tr></thead>
            <tbody>{s.lessons.map((l) => (
              <tr key={l.key}><th scope="row">{l.label}</th><td className="r">{int(l.n)}</td><td className="r">{pct(l.expected, 1)}</td><td className="r">{pct(l.actual, 1)}</td><td className="r">{signed(l.z)}</td>
                <td className={l.active ? '' : 'muted'}>{l.active ? 'Značajno odstupanje' : 'Dobro procenjeno'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Section>
      <Section title="Poslednji promašaji">
        <Segmented label="Vrsta" value={kind} onChange={setKind} options={[['all', 'Svi'], ['greška', 'Greška procene'], ['varijansa', 'Slučajnost']]} />
        {!rows.length ? <Empty>Nema promašaja u ovoj grupi.</Empty> : (
          <ul className="misses">
            {rows.slice(0, limit).map((m) => (
              <li key={m.id}>
                <div className="miss-head"><strong>{m.away} {m.as} : {m.hs} {m.home}</strong><span className="muted">{shortDate(m.date)} Izbor {m.pick} {pct(m.p)}{m.src === 'live' ? ', uživo' : ''}</span></div>
                <p><span className="tag">{m.pm.category}</span> {m.pm.summary}</p>
                {m.pm.factors.length > 0 && <p className="muted small">{m.pm.factors.map((f) => `${f.label}: ${signed(f.points, 0)} p.`).join('; ')}</p>}
              </li>
            ))}
          </ul>
        )}
        {rows.length > limit && <button type="button" className="btn center" onClick={() => setLimit(limit + 25)}>Prikaži još</button>}
      </Section>
    </>
  );
}
