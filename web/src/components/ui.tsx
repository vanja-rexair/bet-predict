import type { ReactNode } from 'react';
import { confidenceLabel, int, level, pct } from '../format.ts';
import type { RecordRow } from '../../../engine/src/types.ts';

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

/** Ukupno, pogođeni, promašeni i uspešnost: glavni zapis koji se vidi na vrhu. */
export function RecordStrip({ r }: { r: RecordRow }) {
  return (
    <dl className="record">
      <div><dt>Ukupno mečeva</dt><dd>{int(r.total)}</dd></div>
      <div><dt>Pogođeni</dt><dd>{int(r.hit)}</dd></div>
      <div><dt>Promašeni</dt><dd>{int(r.miss)}</dd></div>
      <div><dt>Uspešnost</dt><dd>{r.total ? pct(r.pct, 1) : '–'}</dd></div>
    </dl>
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
