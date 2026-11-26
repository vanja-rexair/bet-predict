import { sigmoid } from './metrics.ts';

/** Elo sa maržom pobede, prednošću domaćeg terena i regresijom ka sredini između sezona. */
export class Elo {
  r = new Map<number, number>();
  static readonly HCA = 60;
  get(id: number): number { return this.r.get(id) ?? 1450; }
  newSeason(): void { for (const [k, v] of this.r) this.r.set(k, 1505 + 0.75 * (v - 1505)); }
  expected(home: number, away: number, neutral: boolean): number {
    const d = this.get(home) - this.get(away) + (neutral ? 0 : Elo.HCA);
    return 1 / (1 + 10 ** (-d / 400));
  }
  update(home: number, away: number, hs: number, as: number, neutral: boolean): void {
    const e = this.expected(home, away, neutral);
    const win = hs > as ? 1 : 0;
    const d = (this.get(home) - this.get(away) + (neutral ? 0 : Elo.HCA)) * (win ? 1 : -1);
    const mult = ((Math.abs(hs - as) + 3) ** 0.8) / (7.5 + 0.006 * d);
    const k = 20 * mult * (win - e);
    this.r.set(home, this.get(home) + k);
    this.r.set(away, this.get(away) - k);
  }
}

const Q = Math.LN10 / 400;
/** Glicko-1: pored rejtinga vodi i nesigurnost (RD). */
export class Glicko {
  s = new Map<number, { r: number; rd: number }>();
  static readonly HCA = 65;
  get(id: number) { return this.s.get(id) ?? { r: 1500, rd: 200 }; }
  newSeason(): void { for (const v of this.s.values()) { v.r = 1500 + 0.75 * (v.r - 1500); v.rd = Math.min(150, Math.hypot(v.rd, 70)); } }
  private static g(rd: number) { return 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI)); }
  expected(home: number, away: number, neutral: boolean): number {
    const a = this.get(home), b = this.get(away);
    const g = Glicko.g(Math.hypot(a.rd, b.rd));
    return sigmoid(Q * g * (a.r - b.r + (neutral ? 0 : Glicko.HCA)));
  }
  update(home: number, away: number, homeWon: boolean, neutral: boolean): void {
    const a = { ...this.get(home) }, b = { ...this.get(away) };
    const hca = neutral ? 0 : Glicko.HCA;
    const step = (me: typeof a, op: typeof a, adv: number, won: boolean) => {
      const g = Glicko.g(op.rd);
      const e = sigmoid(Q * g * (me.r + adv - op.r));
      const d2 = 1 / (Q * Q * g * g * e * (1 - e));
      const denom = 1 / (me.rd * me.rd) + 1 / d2;
      return { r: me.r + (Q / denom) * g * ((won ? 1 : 0) - e), rd: Math.max(45, Math.hypot(Math.sqrt(1 / denom), 8)) };
    };
    this.s.set(home, step(a, b, hca, homeWon));
    this.s.set(away, step(b, a, -hca, !homeWon));
  }
}
