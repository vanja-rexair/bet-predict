/** Kratak razlog povrede na srpskom, sastavljen iz ESPN polja (deo tela, strana, dijagnoza). */
type Gender = 'm' | 'f' | 'n';
const BODY: Record<string, [string, Gender]> = {
  knee: ['kolena', 'n'], hamstring: ['zadnje lože', 'f'], foot: ['stopala', 'n'], ankle: ['skočnog zgloba', 'm'], hip: ['kuka', 'm'], shoulder: ['ramena', 'n'],
  calf: ['lista', 'm'], back: ['leđa', 'n'], groin: ['prepone', 'f'], heel: ['pete', 'f'], achilles: ['Ahilove tetive', 'f'], toe: ['nožnog prsta', 'm'], hand: ['šake', 'f'],
  'lower leg': ['potkolenice', 'f'], oblique: ['kosog trbušnog mišića', 'm'], quadriceps: ['kvadricepsa', 'm'], abdomen: ['stomaka', 'm'], leg: ['noge', 'f'], thigh: ['butine', 'f'],
  wrist: ['ručnog zgloba', 'm'], elbow: ['lakta', 'm'], finger: ['prsta', 'm'], thumb: ['palca', 'm'], neck: ['vrata', 'm'], rib: ['rebra', 'n'], ribs: ['rebara', 'n'],
  eye: ['oka', 'n'], face: ['lica', 'n'], nose: ['nosa', 'm'], head: ['glave', 'f'], arm: ['ruke', 'f'], chest: ['grudi', 'f'], shin: ['cevanice', 'f'], forearm: ['podlaktice', 'f'],
  adductor: ['primicača', 'm'], pelvis: ['karlice', 'f'], jaw: ['vilice', 'f'],
};
const WHOLE: Record<string, string> = {
  illness: 'bolest', concussion: 'potres mozga', undisclosed: 'razlog nije objavljen', personal: 'lični razlozi', rest: 'odmor', suspension: 'suspenzija',
  'not injury related': 'nije povreda', conditioning: 'vraćanje u formu', 'load management': 'odmor zbog opterećenja',
};
const DETAIL: Record<string, string> = {
  surgery: 'operacija', strain: 'istegnuće', soreness: 'bol', sprain: 'uganuće', inflammation: 'upala', fracture: 'prelom', bruise: 'nagnječenje', contusion: 'nagnječenje',
  'plantar fasciitis': 'upala stopalne fascije', spasms: 'grčevi', dislocated: 'iščašenje', dislocation: 'iščašenje', 'pinched nerve': 'uklješten nerv',
  tendinitis: 'upala tetive', tendinopathy: 'problem sa tetivom', tightness: 'zategnutost', swelling: 'otok', 'stress fracture': 'stres prelom', laceration: 'posekotina',
};
const SIDE: Record<string, Record<Gender, string>> = {
  left: { m: 'levog', n: 'levog', f: 'leve' },
  right: { m: 'desnog', n: 'desnog', f: 'desne' },
};
const NO_SIDE = new Set(['back', 'neck', 'abdomen', 'head', 'chest', 'nose', 'face']);

export function injuryReason(type?: string, side?: string, detail?: string): string {
  const t = (type ?? '').trim().toLowerCase(), d = (detail ?? '').trim().toLowerCase();
  const diag = !d || d === 'not specified' ? '' : DETAIL[d] ?? detail!.trim();
  if (!t) return diag || 'razlog nije objavljen';
  if (WHOLE[t]) return diag ? `${WHOLE[t]}, ${diag}` : WHOLE[t];
  const b = BODY[t];
  // Nepoznat izraz se prikazuje kako ga izvor navodi, ništa se ne nagađa.
  if (!b) return `povreda (${type!.trim()})${diag ? `, ${diag}` : ''}`;
  const s = NO_SIDE.has(t) ? '' : SIDE[(side ?? '').toLowerCase()]?.[b[1]];
  return `povreda ${s ? s + ' ' : ''}${b[0]}${diag ? `, ${diag}` : ''}`;
}

/** Prihvata se samo link ka ESPN-u. */
export const espnUrl = (u: unknown): string | null => (typeof u === 'string' && /^https:\/\/(www\.)?espn\.com\//.test(u) ? u : null);
