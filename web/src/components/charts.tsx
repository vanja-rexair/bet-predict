import { useState, type KeyboardEvent } from 'react';
import { int, pct } from '../format.ts';

interface Tip { x: number; y: number; title: string; lines: string[] }
function Tooltip({ tip, w }: { tip: Tip | null; w: number }) {
  if (!tip) return null;
  return (
    <div className="tip" role="status" style={{ left: `${(tip.x / w) * 100}%`, top: tip.y, transform: `translate(${tip.x > w * 0.7 ? '-100%' : tip.x < w * 0.3 ? '0' : '-50%'}, -110%)` }}>
      <strong>{tip.title}</strong>
      {tip.lines.map((l) => <span key={l}>{l}</span>)}
    </div>
  );
}

const W = 640, H = 250, PL = 44, PR = 12, PT = 14, PB = 34;

/** Pogođeno po nivou sigurnosti; crtica pokazuje koliko je model očekivao. */
export function BucketChart({ rows }: { rows: { label: string; n: number; hit: number; pct: number; expected: number }[] }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [on, setOn] = useState(-1);
  const y = (v: number) => PT + (1 - v) * (H - PT - PB);
  const bw = (W - PL - PR) / rows.length;
  const show = (i: number) => {
    const r = rows[i];
    setOn(i);
    setTip({ x: PL + bw * (i + 0.5), y: 0, title: `${pct(r.pct, 1)} pogođeno`, lines: [`Sigurnost ${r.label}`, `Očekivano ${pct(r.expected, 1)}`, `${int(r.hit)} od ${int(r.n)} mečeva`] });
  };
  const hide = () => { setTip(null); setOn(-1); };
  return (
    <div className="chart">
      <div className="legend"><span><i className="key bar" />Stvarno pogođeno</span><span><i className="key tick" />Očekivano po modelu</span></div>
      <div className="plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Uspešnost po nivou sigurnosti">
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className={v === 0 ? 'axis' : 'grid'} /><text x={PL - 8} y={y(v) + 4} textAnchor="end">{pct(v)}</text></g>
          ))}
          {rows.map((r, i) => {
            const x = PL + bw * (i + 0.5), bar = Math.min(24, bw - 8), top = y(r.pct), b = y(0);
            return (
              <g key={r.label} tabIndex={0} role="img" aria-label={`Sigurnost ${r.label}: pogođeno ${pct(r.pct, 1)}, očekivano ${pct(r.expected, 1)}, ${r.n} mečeva`}
                onPointerEnter={() => show(i)} onPointerLeave={hide} onFocus={() => show(i)} onBlur={hide}>
                <rect x={PL + bw * i} y={PT} width={bw} height={H - PT - PB} fill="transparent" />
                <path className={on === i ? 'bar on' : 'bar'} d={`M${x - bar / 2},${b}V${top + 4}q0,-4 4,-4h${bar - 8}q4,0 4,4V${b}z`} />
                <line className="expect" x1={x - bar / 2 - 5} x2={x + bar / 2 + 5} y1={y(r.expected)} y2={y(r.expected)} />
                <text x={x} y={H - PB + 18} textAnchor="middle">{r.label}</text>
              </g>
            );
          })}
        </svg>
        <Tooltip w={W} tip={tip} />
      </div>
    </div>
  );
}

/** Kalibracija: tačke na dijagonali znače da se događaji dešavaju onoliko često koliko model kaže. */
export function CalibrationChart({ rows }: { rows: { p: number; actual: number; n: number }[] }) {
  const [on, setOn] = useState(-1);
  const S = 320, P = 44, R = 14;
  const x = (v: number) => P + v * (S - P - R), y = (v: number) => S - P - v * (S - P - R);
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setOn((i) => Math.min(rows.length - 1, i + 1));
    if (e.key === 'ArrowLeft') setOn((i) => Math.max(0, i - 1));
  };
  const r = rows[on];
  return (
    <div className="chart square">
      <div className="plot">
        <svg viewBox={`0 0 ${S} ${S}`} tabIndex={0} role="img" aria-label="Kalibracija modela: predviđena i stvarna učestalost pobeda domaćina" onKeyDown={key} onBlur={() => setOn(-1)} onPointerLeave={() => setOn(-1)}
          onPointerMove={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - b.left) / b.width) * S;
            let best = 0;
            rows.forEach((q, i) => { if (Math.abs(x(q.p) - px) < Math.abs(x(rows[best].p) - px)) best = i; });
            setOn(best);
          }}>
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <g key={v}>
              <line x1={x(0)} x2={x(1)} y1={y(v)} y2={y(v)} className={v === 0 ? 'axis' : 'grid'} />
              <text x={P - 8} y={y(v) + 4} textAnchor="end">{pct(v)}</text>
              <text x={x(v)} y={S - P + 18} textAnchor="middle">{pct(v)}</text>
            </g>
          ))}
          <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="diag" />
          {r && <line x1={x(r.p)} x2={x(r.p)} y1={y(0)} y2={y(1)} className="cross" />}
          <polyline className="line" points={rows.map((q) => `${x(q.p)},${y(q.actual)}`).join(' ')} />
          {rows.map((q, i) => <circle key={q.p} className="dot" cx={x(q.p)} cy={y(q.actual)} r={i === on ? 6 : 4.5} />)}
          <text x={x(0.5)} y={S - 4} textAnchor="middle">Predviđena šansa domaćina</text>
        </svg>
        <Tooltip w={S} tip={r ? { x: x(r.p), y: 8, title: `${pct(r.actual, 1)} stvarno`, lines: [`Predviđeno ${pct(r.p, 1)}`, `${int(r.n)} mečeva`] } : null} />
      </div>
    </div>
  );
}

/** Horizontalne trake za rangirane vrednosti, sa brojem na kraju. */
export function Bars({ rows }: { rows: { label: string; value: number; text: string; note?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1e-9);
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.label} title={r.note}>
          <span className="bars-label">{r.label}</span>
          <span className="bars-track"><span className="bars-fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="bars-value">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Doprinosi oko nule: desno ide u korist domaćina, levo u korist gosta. */
export function Diverging({ rows, left, right }: { rows: { label: string; value: number }[]; left: string; right: string }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0.05);
  return (
    <div className="diverging">
      <div className="diverging-head"><span>← {left}</span><span>{right} →</span></div>
      {rows.map((r) => (
        <div key={r.label} className="diverging-row">
          <span>{r.label}</span>
          <span className="diverging-track" role="img" aria-label={`${r.label}: u korist ${r.value >= 0 ? right : left}`}>
            <span className={r.value >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(r.value) / max) * 50}%`, [r.value >= 0 ? 'left' : 'right']: '50%' }} />
          </span>
        </div>
      ))}
    </div>
  );
}
