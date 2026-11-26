import { useState, type FormEvent } from 'react';
import { cleanServer, getBudget, getServer, isNative, setServer } from '../api.ts';
import { askNotifications, getLevel, syncBackground } from '../native.ts';
import { Section } from '../components/ui.tsx';

export function Settings() {
  const [url, setUrl] = useState(getServer());
  const [level, setLevel] = useState(getLevel());
  const [budget, setBudget] = useState(String(getBudget()));
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    const next = cleanServer(url);
    try {
      if (next) {
        const r = await fetch(`${next}/data/events.json`, { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error();
      }
      setServer(next);
      setUrl(next);
      localStorage.setItem('bp.level', String(level));
      if (isNative) {
        const ok = await askNotifications();
        await syncBackground();
        setMsg(ok ? 'Sačuvano. Obaveštenja su uključena.' : 'Sačuvano, ali obaveštenja nisu dozvoljena u podešavanjima telefona.');
      } else setMsg('Sačuvano.');
    } catch {
      setMsg('Servis na toj adresi ne odgovara. Proverite adresu, da li je računar uključen i da li su uređaji na istoj mreži.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section title="Veza sa servisom" hint={isNative
        ? 'Upišite adresu koju servis ispisuje pri pokretanju na računaru, na primer http://192.168.1.10:8787, ili adresu svog hostinga.'
        : 'Na webu obično ostaje prazno. Upišite adresu samo ako servis radi na drugom računaru.'}>
        <form className="form" onSubmit={save}>
          <label className="field">Adresa servisa
            <input type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.10:8787" />
          </label>
          {isNative && (
            <label className="field">Obaveštenja
              <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                <option value={1}>Sve promene</option>
                <option value={2}>Važno: povrede, kvote, ishodi</option>
                <option value={3}>Samo promena favorita i povrede ključnih igrača</option>
                <option value={9}>Isključeno</option>
              </select>
            </label>
          )}
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Proveravam…' : 'Sačuvaj'}</button>
          <p role="status" className="hint">{msg}</p>
        </form>
      </Section>
      <Section title="Budžet za klađenje" hint="Od njega se računa predlog uloga. Upiši samo iznos koji možeš da izgubiš. Ostaje na ovom uređaju.">
        <form className="form" onSubmit={(e) => { e.preventDefault(); const v = Math.round(Number(budget.replace(/\D/g, ''))); if (v > 0) { localStorage.setItem('bp.budget', String(v)); setBudget(String(v)); setSaved(true); } }}>
          <label className="field">Ukupan budžet (din)
            <input type="text" inputMode="numeric" value={budget} onChange={(e) => { setBudget(e.target.value); setSaved(false); }} />
          </label>
          <button className="btn primary" type="submit">Sačuvaj budžet</button>
          <p role="status" className="hint">{saved ? 'Sačuvano.' : ''}</p>
        </form>
      </Section>
      <Section title="Praćenje u pozadini">
        <p>Servis na računaru ili hostingu proverava mečeve i kad je aplikacija zatvorena: na 2 minuta dok se igra, na 4 do 20 minuta pre toga. Beleži kvote, povrede, promene favorita i rezultate.</p>
        {isNative && <p>Telefon proverava nove događaje otprilike na svakih 15 minuta. Ako obaveštenja kasne, isključite štednju baterije za ovu aplikaciju.</p>}
      </Section>
      <Section title="O predikcijama">
        <p>Model daje verovatnoće, ne sigurne ishode. Nijedan model ne može da pogodi sve NBA mečeve: i kladionice pogađaju favorita u oko 68% mečeva. Ako se kladite, radite to odgovorno i samo novcem koji možete da izgubite.</p>
        <p className="hint">Podaci: ESPN (javni API) i sportsdataverse. Besplatno, bez naloga i ključeva.</p>
      </Section>
    </>
  );
}
