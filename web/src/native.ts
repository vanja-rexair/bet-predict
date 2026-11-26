import { BackgroundRunner } from '@capacitor/background-runner';
import { fetchData, getServer, isNative } from './api.ts';
import type { GameEvent } from '../../engine/src/types.ts';

const LABEL = 'rs.betpredict.tracker';
export const getLevel = (): number => Number(localStorage.getItem('bp.level') ?? 2);

/** Predaje adresu servisa pozadinskom zadatku i pamti do kog događaja je korisnik video. */
export async function syncBackground(): Promise<void> {
  if (!isNative) return;
  let lastId = 0;
  try {
    const { events } = await fetchData<{ events: GameEvent[] }>('events.json');
    lastId = events.reduce((m, e) => Math.max(m, e.id), 0);
  } catch { /* bez mreže: pozadinski zadatak nastavlja od ranije zapamćenog */ }
  await BackgroundRunner.dispatchEvent({ label: LABEL, event: 'config', details: { server: getServer(), level: getLevel(), lastId } });
}

export async function askNotifications(): Promise<boolean> {
  if (!isNative) return false;
  const r = await BackgroundRunner.requestPermissions({ apis: ['notifications'] });
  return r.notifications === 'granted';
}
