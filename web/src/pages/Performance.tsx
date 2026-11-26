import type { RecordRow, Stats } from '../../../engine/src/types.ts';
import { useData } from '../api.ts';
import { dayTime, int, num, pct, shortDate, signed } from '../format.ts';
import { Bars, BucketChart, CalibrationChart } from '../components/charts.tsx';
import { Loading, Section } from '../components/ui.tsx';

const monthName = (m: string) => new Date(m + '-15').toLocaleDateString('sr-Latn-RS', { month: 'long', year: 'numeric' });

export function Performance() {
  const { data: s, error } = useData<Stats>('stats.json', 300_000);
  if (!s) return <Loading error={error} />;
  const rows: RecordRow[] = [{ ...s.live, label: 'Uživo (zaključano pre meča)' }, ...[...s.seasons].reverse(), { ...s.overall, label: 'Ukupno simulacija' }];
  const strong = s.buckets.slice(6);
  const sn = strong.reduce((a, b) => a + b.n, 0), sh = strong.reduce((a, b) => a + b.hit, 0);
  return (
    <>
      <Section title="Zapis po sezonama" hint="Simulacija ide redom kroz vreme: pre svakog meča model zna samo ono što se znalo tada. Jedino sastavi dolaze iz odigranog meča, pa je stvarni učinak uživo obično malo niži.">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Period</th><th className="r">Ukupno</th><th className="r">Pogođeni</th><th className="r">Promašeni</th><th className="r">Uspešnost</th><th className="r">Kladionica</th><th className="r">Log loss</th><th className="r">Brier</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th><td className="r">{int(r.total)}</td><td className="r">{int(r.hit)}</td><td className="r">{int(r.miss)}</td>
                  <td className="r"><strong>{r.total ? pct(r.pct, 1) : '–'}</strong></td><td className="r">{r.market === null ? '–' : pct(r.market, 1)}</td>
                  <td className="r">{r.total ? num(r.logLoss, 3) : '–'}</td><td className="r">{r.total ? num(r.brier, 3) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">Kolona Kladionica: koliko često pobeđuje favorit po završnoj kvoti. Služi samo za poređenje: kvote ne ulaze u prognozu.</p>
      </Section>
      <Section title="Uspešnost po sigurnosti" hint={sn > 0 ? `Kad model da 80% ili više, pogodio je ${pct(sh / sn, 1)} (${int(sh)} od ${int(sn)}). Biranjem samo sigurnijih mečeva uspešnost raste.` : undefined}>
        <BucketChart rows={s.buckets} />
        <details><summary>Prikaži tabelu</summary>
          <div className="table-wrap"><table>
            <thead><tr><th>Sigurnost</th><th className="r">Mečeva</th><th className="r">Pogođeni</th><th className="r">Uspešnost</th><th className="r">Očekivano</th></tr></thead>
            <tbody>{s.buckets.map((b) => <tr key={b.label}><td>{b.label}</td><td className="r">{int(b.n)}</td><td className="r">{int(b.hit)}</td><td className="r">{pct(b.pct, 1)}</td><td className="r">{pct(b.expected, 1)}</td></tr>)}</tbody>
          </table></div>
        </details>
      </Section>
      <Section title="Kalibracija" hint="Što su tačke bliže liniji, to se procentima više može verovati.">
        <CalibrationChart rows={s.calibration} />
        <details><summary>Prikaži tabelu</summary>
          <div className="table-wrap"><table>
            <thead><tr><th className="r">Predviđeno</th><th className="r">Stvarno</th><th className="r">Mečeva</th></tr></thead>
            <tbody>{s.calibration.map((c) => <tr key={c.p}><td className="r">{pct(c.p, 1)}</td><td className="r">{pct(c.actual, 1)}</td><td className="r">{int(c.n)}</td></tr>)}</tbody>
          </table></div>
        </details>
      </Section>
      <Section title="Poređenje modela" hint="Manji log loss i Brier su bolji. Kladionica je merena samo na mečevima za koje postoji kvota.">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Model</th><th className="r">Uspešnost</th><th className="r">Log loss</th><th className="r">Brier</th></tr></thead>
            <tbody>{s.models.map((m) => <tr key={m.name}><th scope="row">{m.name}</th><td className="r">{pct(m.acc, 1)}</td><td className="r">{num(m.logLoss, 4)}</td><td className="r">{num(m.brier, 4)}</td></tr>)}</tbody>
          </table>
        </div>
      </Section>
      <Section title="Procenat pogodaka i zarada" hint="Isti ulog na svaki izbor iznad zadate sigurnosti, po završnoj kvoti od 2018/19. Veći procenat pogodaka dolazi sa manjom kvotom.">
        <div className="table-wrap"><table>
          <thead><tr><th>Sigurnost</th><th className="r">Mečeva</th><th className="r">Pogođeno</th><th className="r">Prosečna kvota</th><th className="r">Potrebno za nulu</th><th className="r">Povraćaj</th></tr></thead>
          <tbody>
            {s.byConfidence.filter((b) => b.n > 0).map((b) => <tr key={b.min}><th scope="row">{b.min === 0.5 ? 'Svi mečevi' : `${pct(b.min)} i više`}</th><td className="r">{int(b.n)}</td><td className="r">{pct(b.pct, 1)}</td><td className="r">{num(b.odds, 2)}</td><td className="r">{pct(b.pct / (1 + b.roi), 1)}</td><td className="r">{signed(b.roi * 100)}%</td></tr>)}
            <tr><th scope="row">Predloženi ulozi (Kelly)</th><td className="r">{int(s.staking.n)}</td><td className="r">{pct(s.staking.pct, 1)}</td><td className="r">–</td><td className="r">–</td><td className="r">{signed(s.staking.roi * 100)}%</td></tr>
            <tr><th scope="row">★ Siguran i dobra kvota</th><td className="r">{int(s.highlight.n)}</td><td className="r">{pct(s.highlight.pct, 1)}</td><td className="r">{num(s.highlight.odds, 2)}</td><td className="r">{s.highlight.n ? pct(s.highlight.pct / (1 + s.highlight.roi), 1) : '–'}</td><td className="r">{signed(s.highlight.roi * 100)}%</td></tr>
          </tbody>
        </table></div>
      </Section>
      <Section title="Papirne opklade uživo" hint="Prate se automatski, bez novca. Tek plus na bar 200 opklada, uz bolju kvotu od završne (CLV), znači da postoji prednost.">
        <dl className="facts wide">
          <div><dt>★ Istaknuti izbori</dt><dd>{int(s.liveHighlight.n)}{s.liveHighlight.n ? `, povraćaj ${signed(s.liveHighlight.roi * 100)}%` : ''}</dd></div>
          <div><dt>Sve dobre kvote</dt><dd>{int(s.liveValue.n)}{s.liveValue.n ? `, povraćaj ${signed(s.liveValue.roi * 100)}%` : ''}</dd></div>
          <div><dt>Prosečan CLV</dt><dd>{s.liveValue.clv === null ? '–' : `${signed(s.liveValue.clv * 100, 2)}%`}</dd></div>
          <div><dt>Stanje</dt><dd>{s.betProven ? 'Plus je dokazan' : 'Još nije dokazano'}</dd></div>
          <div><dt>Sve dobre kvote u simulaciji</dt><dd>{int(s.value.n)}, povraćaj {signed(s.value.roi * 100)}%</dd></div>
          <div><dt>Greška ukupnih poena</dt><dd>{num(s.totals.mae)}{s.totals.marketMae !== null ? ` (kladionica ${num(s.totals.marketMae)})` : ''}</dd></div>
        </dl>
        {!s.betProven && <p className="note">Dok plus nije dokazan, ne ulaži pravi novac.</p>}
      </Section>
      <Section title="Šta model najviše koristi">
        <Bars rows={(s.how?.groups ?? s.importance).map((i) => ({ label: i.group, value: i.share, text: pct(i.share) }))} />
      </Section>
      <Section title="Po mesecima">
        <div className="table-wrap"><table>
          <thead><tr><th>Mesec</th><th className="r">Ukupno</th><th className="r">Pogođeni</th><th className="r">Promašeni</th><th className="r">Uspešnost</th></tr></thead>
          <tbody>{[...s.months].reverse().map((m) => <tr key={m.month}><th scope="row">{monthName(m.month)}</th><td className="r">{int(m.total)}</td><td className="r">{int(m.hit)}</td><td className="r">{int(m.total - m.hit)}</td><td className="r">{pct(m.pct, 1)}</td></tr>)}</tbody>
        </table></div>
      </Section>
      <p className="hint">Model treniran {dayTime(s.trainedAt)} na {int(s.trainedOn)} mečeva. Podaci od {shortDate('2013-10-29')}</p>
    </>
  );
}
