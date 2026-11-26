import type { RecentGame } from '../../../engine/src/types.ts';
import { dayTime, odds, pct, time } from '../format.ts';
import { Chip, Verdict } from './ui.tsx';

/** Završen meč: zeleno ako je prva prognoza bila tačna, crveno ako nije. */
export function PastCard({ g }: { g: RecentGame }) {
  const side = (p: 'home' | 'away') => (p === 'home' ? g.home : g.away);
  const conf = (p: number) => Math.max(p, 1 - p);
  const pick = side(g.initial.pick);
  const changed = g.final && g.final.pick !== g.initial.pick ? g.final : null;
  const homeWon = g.hs > g.as;
  return (
    <article className={`card ${g.hit ? 'is-hit' : 'is-miss'}`}>
      <header className="card-head">
        <Verdict hit={g.hit} />
        {g.start.includes('T') && <time dateTime={g.start}>{time(g.start)}</time>}
        {g.src === 'test' && <span className="muted">Simulacija</span>}
      </header>
      {[g.away, g.home].map((t, i) => {
        const isHome = i === 1, won = isHome === homeWon;
        return (
          <div key={t.id} className={`team${won ? ' picked' : ''}`}>
            <span className="team-name">{t.name}{won && <span className="sr-only"> (pobednik)</span>}</span>
            <span className={`score${won ? ' won' : ''}`}>{isHome ? g.hs : g.as}</span>
          </div>
        );
      })}
      <dl className="said">
        <div><dt>Prva prognoza</dt><dd>{pick.name} {pct(conf(g.initial.p))} <Chip c={conf(g.initial.p)} /></dd></div>
        {changed && <div><dt>Pred meč promenjeno</dt><dd>{side(changed.pick).name} {pct(conf(changed.p))}</dd></div>}
        {!changed && g.final && Math.abs(conf(g.final.p) - conf(g.initial.p)) >= 0.02 && <div><dt>Pred meč</dt><dd>{pct(conf(g.final.p))}</dd></div>}
        {g.advice && (
          <div><dt>Preporuka</dt><dd>{g.advice.play
            ? <>Igraj {side(g.advice.side).abbr} na {odds(g.advice.odds)}, <span className={`verdict ${(g.advice.side === 'home') === homeWon ? 'hit' : 'miss'}`}>{(g.advice.side === 'home') === homeWon ? 'prošla' : 'pala'}</span></>
            : 'Ne igraj'}</dd></div>
        )}
        <div><dt>Ishod</dt><dd>{(homeWon ? g.home : g.away).name} za {Math.abs(g.hs - g.as)}</dd></div>
      </dl>
      {!g.hit && g.postmortem && <p className="pm-short"><strong>{g.postmortem.category}.</strong> {g.postmortem.summary}</p>}
      {g.initial.ts && <p className="muted small">Prognozirano {dayTime(g.initial.ts)}</p>}
    </article>
  );
}
