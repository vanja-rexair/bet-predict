import type { ReactNode } from 'react';
import { confidenceLabel, int, level, num, pct, signed } from '../format.ts';
import type { Flat, RecordRow } from '../../../engine/src/types.ts';

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

/** Da li se isplati: potrebna uspešnost za tu kvotu, stvarni povraćaj i koliko se uzorku sme verovati. */
function WorthIt({ f }: { f: Flat }) {
  const acc = f.hit / f.n, need = f.roi > -1 ? acc / (1 + f.roi) : 1 / f.odds;
  const few = f.n < 300;
  const verdict = few ? (f.roi > 0 ? 'Trenutno u plusu, ali je uzorak premali za zaključak' : 'Trenutno u minusu, uzorak je mali') : f.roi > 0 ? 'U plusu' : 'Ne isplati se';
  return (
    <p className="worth">
      <span>Za nulu treba <strong>{pct(need, 1)}</strong> pogodaka</span>
      <span>Povraćaj <strong>{signed(f.roi * 100)}%</strong></span>
      <span>{verdict} ({int(f.n)})</span>
    </p>
  );
}

/** Ukupno, pogođeni, promašeni i uspešnost: glavni zapis koji se vidi na vrhu. */
export function RecordStrip({ r }: { r: RecordRow }) {
  return (
    <>
    <dl className="record">
      <div><dt>Ukupno mečeva</dt><dd>{int(r.total)}</dd></div>
      <div><dt>Pogođeni</dt><dd>{int(r.hit)}</dd></div>
      <div><dt>Promašeni</dt><dd>{int(r.miss)}</dd></div>
      <div><dt>Uspešnost</dt><dd>{r.total ? pct(r.pct, 1) : '–'}{r.flat && r.flat.n > 0 && <span className="avg-odd">prosečna kvota {num(r.flat.odds, 2)}</span>}</dd></div>
    </dl>
    {r.flat && r.flat.n > 0 && <WorthIt f={r.flat} />}
    </>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Loading({ error }: { error: boolean }) {
  return <Empty>{error ? 'Podaci trenutno nisu dostupni. Proverite da li servis radi i da li je adresa u podešavanjima tačna.' : 'Učitavam podatke…'}</Empty>;
}

export function Verdict({ hit }: { hit: boolean }) {
  return <span className={`verdict ${hit ? 'hit' : 'miss'}`}><span aria-hidden="true">{hit ? '✓' : '✕'}</span> {hit ? 'Pogodak' : 'Promašaj'}</span>;
}

/** Status sigurnosti prognoze; tekst nosi značenje, boja samo pomaže. */
export function Chip({ c }: { c: number }) {
  return <span className={`chip chip-${level(c)}`}>{confidenceLabel(c)}</span>;
}
