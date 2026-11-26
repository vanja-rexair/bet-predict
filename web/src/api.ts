import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';

// Keš starog oblika podataka se briše da ne bi srušio novu verziju aplikacije.
for (const k of Object.keys(localStorage)) if (k.startsWith('bp.cache.')) localStorage.removeItem(k);

export const isNative = Capacitor.isNativePlatform();
const KEY = 'bp.server';

/**
 * Adresa servisa. Na Androidu dolazi iz VITE_SERVER, na sajtu (GitHub Pages) iz VITE_DATA,
 * a lokalno je to isto poreklo. Korisnik je može promeniti u podešavanjima.
 */
const DEFAULT = ((isNative ? import.meta.env.VITE_SERVER : import.meta.env.VITE_DATA) as string | undefined) ?? '';
export const getServer = (): string => localStorage.getItem(KEY) || DEFAULT;
/** Budžet za klađenje u dinarima; ostaje samo na ovom uređaju. */
export const getBudget = (): number => Number(localStorage.getItem('bp.budget')) || 10_000;
export function cleanServer(v: string): string {
  const s = v.trim().replace(/\/+$/, '');
  return s && !/^https?:\/\//i.test(s) ? `http://${s}` : s;
}
export const setServer = (v: string) => localStorage.setItem(KEY, cleanServer(v));

const base = () => getServer() || '.';

export async function fetchData<T>(name: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${base()}/data/${name}`, { cache: 'no-cache', signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** Traži od servisa proveru odmah. Na statičnom hostingu ne postoji, pa samo vraća false. */
export async function refreshServer(): Promise<boolean> {
  try {
    const r = await fetch(`${base()}/api/refresh`, { method: 'POST' });
    return r.ok;
  } catch {
    return false;
  }
}

export interface Loaded<T> { data: T | null; error: boolean; reload: () => void }

/** Učitava JSON, čuva poslednju kopiju za rad bez mreže i osvežava dok je ekran vidljiv. */
export function useData<T>(name: string, everyMs = 60_000): Loaded<T> {
  const key = `bp.cache3.${name}`;
  const [data, setData] = useState<T | null>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null; } catch { return null; }
  });
  const [error, setError] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    ctl.current?.abort();
    const c = (ctl.current = new AbortController());
    try {
      const d = await fetchData<T>(name, c.signal);
      setData(d);
      setError(false);
      try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* nema mesta: radimo bez keša */ }
    } catch {
      if (!c.signal.aborted) setError(true);
    }
  }, [name, key]);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, everyMs);
    const vis = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); ctl.current?.abort(); };
  }, [load, everyMs]);
  return { data, error, reload: () => void load() };
}
