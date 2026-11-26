import { useEffect, useState, type ComponentType } from 'react';
import { getServer, isNative } from './api.ts';
import { syncBackground } from './native.ts';
import { Games } from './pages/Games.tsx';
import { Week } from './pages/Week.tsx';
import { History } from './pages/History.tsx';
import { Performance } from './pages/Performance.tsx';
import { Mistakes } from './pages/Mistakes.tsx';
import { How } from './pages/How.tsx';
import { Teams } from './pages/Teams.tsx';
import { Settings } from './pages/Settings.tsx';

const PAGES: [string, string, ComponentType, string][] = [
  ['mecevi', 'Mečevi', Games, 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3v18M6 5.5c3 3.5 3 9.5 0 13M18 5.5c-3 3.5-3 9.5 0 13'],
  ['istorija', 'Istorija', Week, 'M12 4a8 8 0 1 1-7.5 5.2M4 4v5.5h5.5M12 8v4.5l3 2'],
  ['rezultati', 'Sezona', History, 'M4 6h16M4 12h16M4 18h10'],
  ['ucinak', 'Učinak', Performance, 'M4 20V10M10 20V4M16 20v-7M22 20H2'],
  ['greske', 'Greške', Mistakes, 'M12 4 2.5 20h19zM12 10v4M12 17v.5'],
  ['faq', 'FAQ', How, 'M9.5 9a2.6 2.6 0 1 1 3.8 2.3c-.9.5-1.3 1.1-1.3 2.2M12 17v.3M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18'],
  ['timovi', 'Timovi', Teams, 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 20c0-4 3-6 6-6s6 2 6 6M16 5a3 3 0 0 1 0 6M17 14c3 .5 5 2.5 5 6'],
];
const hash = () => location.hash.replace(/^#\/?/, '') || 'mecevi';

export function App() {
  const [route, setRoute] = useState(hash);
  useEffect(() => {
    const f = () => { setRoute(hash()); window.scrollTo(0, 0); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  useEffect(() => { void syncBackground().catch(() => undefined); }, []);
  const page = PAGES.find(([k]) => k === route);
  const Page = route === 'podesavanja' ? Settings : page?.[2] ?? Games;
  return (
    <>
      <header className="top">
        <a className="brand" href="#/mecevi"><img src="./icon.svg" alt="" width="28" height="28" />NBA predikcije</a>
        <nav className="nav" aria-label="Glavna navigacija">
          {PAGES.map(([k, label, , d]) => (
            <a key={k} href={`#/${k}`} aria-current={k === route ? 'page' : undefined}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg><span>{label}</span>
            </a>
          ))}
        </nav>
        <a className="gear" href="#/podesavanja" aria-label="Podešavanja" aria-current={route === 'podesavanja' ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4" /></svg>
        </a>
      </header>
      <main>
        {isNative && !getServer() && route !== 'podesavanja' && (
          <p className="banner">Prikazani su podaci iz paketa aplikacije. <a href="#/podesavanja">Povežite servis</a> za sveže podatke i obaveštenja.</p>
        )}
        <h1 className="sr-only">{page?.[1] ?? 'Podešavanja'}</h1>
        <Page />
      </main>
    </>
  );
}
