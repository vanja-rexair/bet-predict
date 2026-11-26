import { useId, useState } from 'react';
import type { BetStat, GameView, OutPlayer, TeamRef } from '../../../engine/src/types.ts';
import { dayTime, int, num, odds, pct, pickTeam, quarter, shortDate, signed, time } from '../format.ts';
import { getBudget } from '../api.ts';
import { stakeRsd } from '../../../engine/src/market.ts';
import { Chip, Verdict } from './ui.tsx';
import { Diverging } from './charts.tsx';

function TeamLine({ t, p, picked, score, won, odd }: { t: TeamRef; p: number; picked: boolean; score: number | null; won: boolean; odd: number | null }) {
  return (
    <div className={`team${picked ? ' picked' : ''}`}>
      <span className="team-name">{t.name}</span>
      {score !== null && <span className={`score${won ? ' won' : ''}`}>{score}</span>}
      <span className="odd"><span className="odd-label">kvota</span> {odds(odd)}</span>
      <span className="prob">{pct(p)}</span>
    </div>
  );
}

/** Odakle je podatak o povredi i kada je objavljen. */
function Source({ o }: { o: OutPlayer }) {
  if (!o.reason) return null;
  const when = o.reported ? `, ${dayTime(o.reported)}` : '';
  return <span className="src">Izvor: {o.url ? <a href={o.url} target="_blank" rel="noreferrer">ESPN</a> : 'ESPN'}{when}</span>;
}

/** Neizvesni igrači stoje odmah na kartici, sa razlogom i izvorom. */
function Doubtful({ g }: { g: GameView }) {
  const list = ([[g.away, g.outAway], [g.home, g.outHome]] as const).flatMap(([t, l]) => l.filter((o) => o.status !== 'Ne igra').map((o) => ({ t, o })));
  if (!list.length) return null;
  return (
    <div className="doubt">
      <strong>Neizvesni</strong>
      <ul>
        {list.map(({ t, o }) => (
          <li key={t.id + o.name}>
            {o.name} ({t.abbr}): {o.reason ?? 'razlog se učitava'}{o.expected ? `, moguć povratak ${shortDate(o.expected).replace(/ [0-9]{4}[.]$/, '')}` : ''} <Source o={o} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Outs({ t, list }: { t: TeamRef; list: OutPlayer[] }) {
  if (!list.length) return <p><strong>{t.name}:</strong> nema prijavljenih povreda važnih igrača.</p>;
  return (
    <div>
      <strong>{t.name}</strong>
      <ul className="plain">
        {list.map((o) => <li key={o.name}>{o.name}: {o.status.toLowerCase()}{o.reason ? `, ${o.reason}` : ''} <span className="muted">(prosek {o.min} min, uticaj {signed(o.impact)})</span> <Source o={o} /></li>)}
      </ul>
    </div>
  );
}

/** Predlog uloga na naš izbor: zavisi od šanse, kvote i budžeta. */
function Stake({ g, proven }: { g: GameView; proven: boolean }) {
  const odd = g.closeOddsPick;
  if (!odd) return null;
  const s = stakeRsd(g.confidence, odd, getBudget());
  if (!s) return <p className="stake"><span>Predlog uloga: <strong>0 din</strong></span><span className="muted small">isplativo tek od kvote {num(1 / g.confidence + 0.005, 2)}</span></p>;
  return <p className="stake"><span>Predlog uloga: <strong>{int(s)} din</strong></span><span className="muted small">dobitak +{int(Math.round(s * (odd - 1)))} din{proven ? '' : ', papirno'}</span></p>;
}

/** Objašnjenje zvezdice; otvara se prelaskom miša, fokusom ili dodirom. */
function StarTip({ g }: { g: GameView }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const id = useId();
  const odd = g.closeOddsPick ?? 0;
  return (
    <span className="star" onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)} onPointerLeave={() => setHover(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') { setPinned(false); setHover(false); } }}>
      <button type="button" aria-expanded={pinned || hover} aria-describedby={pinned || hover ? id : undefined} onClick={() => setPinned(!pinned)} onBlur={() => setPinned(false)}>
        ★ Siguran i dobra kvota <span className="q" aria-hidden="true">?</span>
      </button>
      {(pinned || hover) && (
        <span role="tooltip" id={id} className="star-tip">
          <strong>Zvezdica</strong> znači dve stvari odjednom: analiza timu daje bar 70% šanse, a kvota je bar 5% bolja od naše procene.
          <br /><br />
          <strong>Bolja kvota:</strong> za šansu od {pct(g.confidence)} poštena kvota je {odds(1 / g.confidence)}, a nudi se {odds(odd)}. Razlika je {signed((g.confidence * odd - 1) * 100)}%.
          <br /><br />
          Kvota ne utiče na prognozu i zvezdica nije garancija dobitka.
        </span>
      )}
    </span>
  );
}

export function GameCard({ g, past, proven }: { g: GameView; past: BetStat | null; proven: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const pick = pickTeam(g);
  const live = g.live.state === 'in';
  const started = g.live.state !== 'pre';
  const wp = g.live.winProb;
  // Tokom meča prikazuje se šansa uživo, a predikcija pre meča ostaje zapisana ispod.
  const shown = live && wp !== null ? wp : g.pHome;
  // Boja završenog meča ide prema prvoj prognozi.
  const firstHit = g.result ? (g.result.hs > g.result.as) === (g.initial.pick === 'home') : null;
  const hs = g.result?.hs ?? g.live.hs, as = g.result?.as ?? g.live.as;
  const projH = (g.total + g.margin) / 2, projA = (g.total - g.margin) / 2;
  return (
    <article className={`card${firstHit === null ? (g.highlight ? ' is-top' : '') : firstHit ? ' is-hit' : ' is-miss'}`}>
      <header className="card-head">
        {live ? <span className="live"><i aria-hidden="true" />Uživo, {quarter(g.live.period, g.live.clock)}</span>
          : g.result ? <Verdict hit={firstHit!} /> : started ? <span className="muted">Čeka se zvaničan rezultat</span> : <time dateTime={g.start}>{time(g.start)}</time>}
        {g.playoff && <span className="muted">Plej-of</span>}
        {g.highlight && <StarTip g={g} />}
      </header>
      <TeamLine t={g.away} p={1 - shown} picked={g.pick === 'away'} score={started ? as : null} won={!!g.result && as > hs} odd={g.odds?.away ?? null} />
      <TeamLine t={g.home} p={shown} picked={g.pick === 'home'} score={started ? hs : null} won={!!g.result && hs > as} odd={g.odds?.home ?? null} />
      <div className="split" role="img" aria-label={`${g.away.name} ${pct(1 - shown)}, ${g.home.name} ${pct(shown)}`}>
        <span className={g.pick === 'away' ? 'on' : ''} style={{ flexGrow: 1 - shown }} /><span className={g.pick === 'home' ? 'on' : ''} style={{ flexGrow: shown }} />
      </div>
      <p className="pick">
        <span>{started ? 'Izbor pre meča' : 'Izbor'}: <strong>{pick.name}</strong>, {pct(g.confidence)}{g.initial.pick !== g.pick ? ` (prvo: ${(g.initial.pick === 'home' ? g.home : g.away).abbr})` : ''}</span>
        <span className="pick-end">{started && <span className="muted">zaključano</span>}<Chip c={g.confidence} /></span>
      </p>
      {!g.odds && !started && <p className="muted small">Kvote još nisu objavljene.</p>}
      {g.highlight && !started && past && past.n > 0 && (
        <p className="small muted">Ovakvi izbori u simulaciji: {pct(past.pct, 1)} pogođeno od {int(past.n)}, povraćaj {signed(past.roi * 100)}%.</p>
      )}
      {!started && <Doubtful g={g} />}
      {!started && <Stake g={g} proven={proven} />}
      {g.postmortem && <p className="pm-short"><strong>{g.postmortem.category}.</strong> {g.postmortem.summary}</p>}
      <button type="button" className="more" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{open ? 'Sakrij detalje' : 'Detalji'}</button>
      {open && (
        <div id={id} className="details">
          <dl className="facts">
            <div><dt>Projekcija</dt><dd>{g.home.abbr} {num(projH, 0)} : {num(projA, 0)} {g.away.abbr}</dd></div>
            <div><dt>Razlika domaćina</dt><dd>{signed(g.margin)}</dd></div>
            <div><dt>Ukupno poena</dt><dd>{num(g.total, 0)}{g.odds?.total ? ` (granica ${num(g.odds.total, 1)})` : ''}</dd></div>
            <div><dt>Prva prognoza</dt><dd>{(g.initial.pick === 'home' ? g.home : g.away).abbr} {pct(Math.max(g.initial.p, 1 - g.initial.p))}</dd></div>
            {g.odds && <div><dt>Kvote ({g.odds.provider})</dt><dd>{g.home.abbr} {odds(g.odds.home)}, {g.away.abbr} {odds(g.odds.away)}</dd></div>}
            {g.odds?.homeOpen && <div><dt>Početne kvote</dt><dd>{g.home.abbr} {odds(g.odds.homeOpen)}, {g.away.abbr} {odds(g.odds.awayOpen)}</dd></div>}
            {g.odds && <div><dt>Šansa po kvoti (ne utiče)</dt><dd>{g.home.abbr} {pct(g.odds.implied, 1)}</dd></div>}
            {g.clv !== null && <div><dt>CLV</dt><dd>{signed(g.clv * 100)}%</dd></div>}
          </dl>
          {g.notes.length > 0 && <ul className="plain">{g.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          <h4>Šta je odlučilo</h4>
          <Diverging rows={g.factors.map((f) => ({ label: f.group, value: f.value }))} left={g.away.abbr} right={g.home.abbr} />
          <h4>Sastavi</h4>
          <Outs t={g.home} list={g.outHome} />
          <Outs t={g.away} list={g.outAway} />
          {g.events.length > 0 && (
            <>
              <h4>Praćenje meča</h4>
              <ol className="timeline">{g.events.map((e) => <li key={e.id}><time dateTime={e.ts}>{dayTime(e.ts)}</time><span>{e.text}</span></li>)}</ol>
            </>
          )}
        </div>
      )}
    </article>
  );
}
