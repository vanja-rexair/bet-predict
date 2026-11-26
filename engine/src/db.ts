import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from './config.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games(
  id INTEGER PRIMARY KEY, season INT, stype INT, date TEXT, start TEXT, home INT, away INT,
  hs INT, as_ INT, final INT DEFAULT 0, neutral INT DEFAULT 0);
CREATE INDEX IF NOT EXISTS games_date ON games(date);
CREATE TABLE IF NOT EXISTS team_box(
  game_id INT, team_id INT, pts INT, fgm INT, fga INT, tpm INT, tpa INT, ftm INT, fta INT,
  orb INT, drb INT, tov INT, ast INT, stl INT, blk INT, pf INT, PRIMARY KEY(game_id, team_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS player_box(
  game_id INT, team_id INT, pid INT, min REAL, fgm INT, fga INT, tpm INT, ftm INT, fta INT,
  orb INT, drb INT, ast INT, stl INT, blk INT, tov INT, pf INT, pm INT, pts INT, starter INT,
  PRIMARY KEY(game_id, pid)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS players(pid INTEGER PRIMARY KEY, name TEXT, dob TEXT);
CREATE TABLE IF NOT EXISTS odds(
  game_id INTEGER PRIMARY KEY, provider TEXT, mlh_open REAL, mla_open REAL, mlh_close REAL, mla_close REAL,
  spread_open REAL, spread_close REAL, total_open REAL, total_close REAL, fetched TEXT);
CREATE TABLE IF NOT EXISTS odds_snap(
  game_id INT, ts TEXT, mlh REAL, mla REAL, spread REAL, total REAL, PRIMARY KEY(game_id, ts)) WITHOUT ROWID;
-- Walk-forward predikcije osnovnih modela; zamrznuti blokovi se ne računaju ponovo.
CREATE TABLE IF NOT EXISTS oof(
  game_id INTEGER PRIMARY KEY, version INT, block TEXT, base TEXT, margin REAL, total REAL);
CREATE TABLE IF NOT EXISTS oof_block(block TEXT, version INT, games INT, PRIMARY KEY(block, version)) WITHOUT ROWID;
-- Prave predikcije: zaključavaju se na početku meča i posle toga se ne menjaju.
CREATE TABLE IF NOT EXISTS live(game_id INTEGER PRIMARY KEY, created TEXT, locked INT DEFAULT 0, payload TEXT);
-- Vremenska linija praćenja svakog meča.
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INT, ts TEXT, type TEXT, importance INT, title TEXT, text TEXT);
CREATE INDEX IF NOT EXISTS events_game ON events(game_id);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
`;

export type DB = DatabaseSync;

export function openDb(file = DB_PATH): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=30000;');
  db.exec(SCHEMA);
  return db;
}
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export function getMeta(db: DB, k: string): string | null {
  return (db.prepare('SELECT v FROM meta WHERE k=?').get(k) as { v: string } | undefined)?.v ?? null;
}
export function setMeta(db: DB, k: string, v: string): void {
  db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v);
}
