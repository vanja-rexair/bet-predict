/** Čita CSV (RFC 4180: navodnici i prelomi unutar polja) i vraća samo tražene kolone. */
export function* parseCsv(text: string, cols: string[]): Generator<string[]> {
  let i = 0;
  const n = text.length;
  function row(): string[] | null {
    if (i >= n) return null;
    const out: string[] = [];
    for (;;) {
      let f = '';
      if (text[i] === '"') {
        i++;
        for (;;) {
          const q = text.indexOf('"', i);
          if (q < 0) { f += text.slice(i); i = n; break; }
          f += text.slice(i, q);
          if (text[q + 1] === '"') { f += '"'; i = q + 2; } else { i = q + 1; break; }
        }
      }
      let j = i;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === 44 || c === 10 || c === 13) break;
        j++;
      }
      f += text.slice(i, j);
      i = j;
      out.push(f);
      if (text.charCodeAt(i) === 44) { i++; continue; }
      if (text.charCodeAt(i) === 13) i++;
      if (text.charCodeAt(i) === 10) i++;
      return out;
    }
  }
  const header = row();
  if (!header) return;
  const idx = cols.map((c) => header.indexOf(c));
  for (let r = row(); r; r = row()) {
    if (r.length < 2) continue;
    const cur = r;
    yield idx.map((k) => (k < 0 ? '' : cur[k] ?? ''));
  }
}
