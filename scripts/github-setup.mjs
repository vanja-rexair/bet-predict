// Prebacuje praćenje na GitHub: privatan repozitorijum za kod, javni samo za JSON prognoze.
// Pokretanje: npm run github          Provera bez slanja: npm run github -- --proveri
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE = 'nba-predikcije', DATA = 'nba-prognoze';
const dry = process.argv.includes('--proveri');
const opt = { cwd: root, encoding: 'utf8' };
const run = (cmd, args, extra = {}) => execFileSync(cmd, args, { ...opt, stdio: ['pipe', 'pipe', 'pipe'], ...extra }).trim();
const ok = (cmd, args) => { try { run(cmd, args); return true; } catch { return false; } };
const say = (s) => console.log(s);
const cred = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];
const sysRoot = process.env.SystemRoot ?? 'C:\\Windows';
const keygen = [path.join(sysRoot, 'System32/OpenSSH/ssh-keygen.exe'), 'ssh-keygen'].find((p) => p === 'ssh-keygen' || fs.existsSync(p));
const tar = path.join(sysRoot, 'System32/tar.exe');

if (!ok('gh', ['auth', 'status'])) throw new Error('Prvo se prijavi: gh auth login');
const login = run('gh', ['api', 'user', '-q', '.login']), id = run('gh', ['api', 'user', '-q', '.id']);
const code = `${login}/${CODE}`, data = `${login}/${DATA}`;
const need = ['data/nba.sqlite', 'data/model.json', 'data/backtest.json', 'data/public/today.json', 'state/live.json'];
for (const f of need) if (!fs.existsSync(path.join(root, f))) throw new Error(`Nedostaje ${f}: prvo pokreni npm run update`);

// Ništa iz ovih putanja ne sme da ode na GitHub.
if (!fs.existsSync(path.join(root, '.git'))) run('git', ['init', '-q', '-b', 'main']);
run('git', ['add', '-A']);
const bad = run('git', ['ls-files']).split('\n').filter((f) => /^(data|state|\.tools|dist-apk)\/|\.env|local\.properties|\.keystore$|\.jks$|\.apk$/.test(f));
if (bad.length) throw new Error('Osetljivi fajlovi u listi za slanje: ' + bad.join(', '));
const exists = { [code]: ok('gh', ['api', `repos/${code}`]), [data]: ok('gh', ['api', `repos/${data}`]) };
say(`Alati: gh da, ssh-keygen ${fs.existsSync(keygen) ? 'da' : 'iz PATH-a'}, tar ${fs.existsSync(tar) ? 'da' : 'NE'}`);
say(`Privatan kod: ${CODE} (${exists[code] ? 'već postoji' : 'biće napravljen'})`);
say(`Javne prognoze: ${DATA} (${exists[data] ? 'već postoji' : 'biće napravljen'})`);
if (dry) { say('Provera je gotova, ništa nije poslato.'); process.exit(0); }

// Anonimna GitHub adresa, da se lični mejl ne vidi u istoriji.
run('git', ['config', 'user.name', login]);
run('git', ['config', 'user.email', `${id}+${login}@users.noreply.github.com`]);
if (run('git', ['status', '--porcelain'])) run('git', ['commit', '-q', '-m', 'NBA predikcije: engine, web i Android aplikacija']);

if (!exists[code]) run('gh', ['repo', 'create', code, '--private']);
const vis = run('gh', ['api', `repos/${code}`, '-q', '.visibility']);
if (vis !== 'private') throw new Error(`${CODE} nije privatan, prekidam.`);
if (!exists[data]) run('gh', ['repo', 'create', data, '--public']);
say('1/6 Repozitorijumi spremni');

const url = `https://github.com/${code}.git`;
if (ok('git', ['remote', 'get-url', 'origin'])) run('git', ['remote', 'set-url', 'origin', url]);
else run('git', ['remote', 'add', 'origin', url]);
run('git', [...cred, 'push', '-q', '-u', 'origin', 'HEAD:main']);
say('2/6 Kod poslat u privatan repozitorijum');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nba-'));
try {
  fs.mkdirSync(path.join(tmp, 'data/public'), { recursive: true });
  const db = new DatabaseSync(path.join(root, 'data/nba.sqlite'));
  db.exec(`VACUUM INTO '${path.join(tmp, 'data/nba.sqlite').replaceAll('\\', '/').replaceAll("'", "''")}'`);
  db.close();
  for (const f of ['model.json', 'backtest.json']) fs.copyFileSync(path.join(root, 'data', f), path.join(tmp, 'data', f));
  const tgz = path.join(tmp, 'data.tar.gz');
  run(tar, ['-czf', tgz, '-C', tmp, 'data']);
  if (ok('gh', ['release', 'view', 'seed', '--repo', code])) run('gh', ['release', 'upload', 'seed', tgz, '--clobber', '--repo', code]);
  else run('gh', ['release', 'create', 'seed', tgz, '--repo', code, '--title', 'Pocetna baza', '--notes', 'Pocetna baza za pracenje']);
  say('3/6 Početna baza poslata (privatno)');

  if (!run('git', [...cred, 'ls-remote', 'origin', 'refs/heads/state'])) {
    const blob = run('git', ['hash-object', '-w', 'state/live.json']);
    const tree = run('git', ['mktree'], { input: `100644 blob ${blob}\tlive.json\n` });
    const commit = run('git', ['commit-tree', tree, '-m', 'zapis']);
    run('git', [...cred, 'push', '-q', 'origin', `${commit}:refs/heads/state`]);
  }
  say('4/6 Dosadašnje prognoze prenete');

  // Ključ sme da piše samo u repozitorijum sa prognozama; lokalna kopija se briše.
  const key = path.join(tmp, 'key');
  run(keygen, ['-q', '-t', 'ed25519', '-N', '', '-C', 'prognoze', '-f', key]);
  run('gh', ['repo', 'deploy-key', 'add', key + '.pub', '--repo', data, '--allow-write', '--title', 'objava prognoza']);
  run('gh', ['secret', 'set', 'DATA_DEPLOY_KEY', '--repo', code], { input: fs.readFileSync(key, 'utf8') });
  run('gh', ['variable', 'set', 'DATA_REPO', '--repo', code, '--body', data]);
  say('5/6 Ključ za objavu podešen');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

run('gh', ['workflow', 'run', 'track.yml', '--repo', code, '--ref', 'main']);
say('6/6 Praćenje pokrenuto, čekam prvu objavu (do 10 minuta)...');
const remote = `https://raw.githubusercontent.com/${data}/main`;
let live = false;
for (let i = 0; i < 40 && !live; i++) {
  await new Promise((r) => setTimeout(r, 15_000));
  live = await fetch(`${remote}/data/today.json`).then((r) => r.ok, () => false);
}
if (!live) {
  say('Prva objava još nije stigla. Pogledaj: gh run list --repo ' + code + ' , pa ponovo pokreni npm run github.');
  process.exit(1);
}
// Tek kad podaci stvarno stižu: računar postaje ogledalo, a APK dobija adresu.
fs.writeFileSync(path.join(root, 'data/remote.txt'), remote);
fs.writeFileSync(path.join(root, 'web/.env.local'), `VITE_SERVER=${remote}\n`);
say(`Gotovo. Adresa za telefon: ${remote}`);
say('Još: zatvori i ponovo pokreni start.cmd, pa npm run apk i instaliraj novi APK.');
