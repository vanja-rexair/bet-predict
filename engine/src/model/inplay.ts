import { normCdf } from '../ml/metrics.ts';

/** Udeo meča koji je preostao (0 do 1); u produžetku se gleda samo preostali produžetak. */
export function remaining(period: number, clock: string): number {
  const [m, s] = clock.includes(':') ? clock.split(':').map(Number) : [0, Number(clock)];
  const left = (Number.isFinite(m) ? m : 0) + (Number.isFinite(s) ? s : 0) / 60;
  if (period > 4) return Math.min(5, left) / 48;
  return Math.max(0, (Math.max(0, 4 - period) * 12 + Math.min(12, left)) / 48);
}

/** Verovatnoća pobede domaćina tokom meča: trenutna razlika plus ostatak predmečne procene. */
export function inPlayProb(diff: number, frac: number, preMargin: number, sd: number): number {
  if (frac <= 0) return diff > 0 ? 0.999 : diff < 0 ? 0.001 : 0.5;
  return Math.min(0.999, Math.max(0.001, normCdf((diff + preMargin * frac) / (sd * Math.sqrt(frac)))));
}
