/** Oblik JSON podataka koje dele engine i aplikacija. */
export interface TeamRef { id: number; abbr: string; name: string }
export interface OutPlayer {
  name: string; min: number; impact: number; prob: number; status: string;
  reason?: string; reported?: string | null; expected?: string | null; url?: string | null;
}
export interface OddsView {
  provider: string; home: number; away: number; homeOpen: number | null; awayOpen: number | null;
  spread: number | null; total: number | null; implied: number;
}
export interface ValueBet { side: 'home' | 'away'; odds: number; ev: number; stake: number }
export interface GameEvent { id: number; gameId: number; ts: string; type: string; importance: number; title: string; text: string }
export interface Postmortem {
  nature: 'varijansa' | 'greška'; category: string; summary: string; factors: { label: string; points: number }[];
}
export interface ParamInfo { key: string; label: string; desc: string; group: string; share: number }
export interface BetStat { n: number; hit: number; pct: number; odds: number; roi: number }
export interface Initial { p: number; pick: 'home' | 'away'; ts: string }
/** Završen meč iz poslednjih 7 dana: šta je prvo rečeno i kako se završilo. */
export interface RecentGame {
  id: number; date: string; start: string; home: TeamRef; away: TeamRef; hs: number; as: number; src: 'live' | 'test';
  initial: { p: number; pick: 'home' | 'away'; ts: string | null }; final: { p: number; pick: 'home' | 'away' } | null;
  hit: boolean; postmortem: Postmortem | null;
}
export interface LiveState { state: 'pre' | 'in' | 'post'; hs: number; as: number; period: number; clock: string; winProb: number | null }
export interface GameView {
  id: number; date: string; start: string; season: number; home: TeamRef; away: TeamRef; neutral: boolean; playoff: boolean; venue: string;
  /** Verovatnoća pobede domaćina, samo iz analize (bez kvota). */
  pHome: number;
  /** Prva prognoza za ovaj meč; nikad se ne menja. */
  initial: Initial; pick: 'home' | 'away'; confidence: number; margin: number; total: number; sdMargin: number;
  odds: OddsView | null; /** Siguran izbor i dobra kvota. */
  highlight: boolean;
  /** Šansa domaćina po svakom osnovnom modelu. */
  models?: { name: string; p: number }[];
  value: ValueBet | null; lineMove: number | null;
  factors: { group: string; value: number }[]; outHome: OutPlayer[]; outAway: OutPlayer[]; notes: string[];
  created: string; locked: boolean; firstOddsPick: number | null; closeOddsPick: number | null; clv: number | null;
  live: LiveState; result: { hs: number; as: number; hit: boolean } | null; postmortem: Postmortem | null; events: GameEvent[];
}
export interface HistoryRow {
  id: number; date: string; home: string; away: string; p: number; pick: 'home' | 'away'; hs: number; as: number; hit: boolean; src: 'live' | 'test'; odds: number | null;
}
export interface RecordRow { label: string; total: number; hit: number; miss: number; pct: number; market: number | null; logLoss: number; brier: number }
export interface Stats {
  generatedAt: string; version: number; trainedAt: string; trainedOn: number;
  live: RecordRow; season: RecordRow; overall: RecordRow; seasons: RecordRow[];
  models: { name: string; acc: number; logLoss: number; brier: number }[];
  buckets: { label: string; n: number; hit: number; pct: number; expected: number }[];
  calibration: { p: number; actual: number; n: number }[];
  months: { month: string; total: number; hit: number; pct: number }[];
  lessons: Lesson[]; lessonGate: { active: boolean; before: number; after: number; n: number }; teamGate: { active: boolean; before: number; after: number; n: number };
  missCategories: { category: string; n: number; share: number; variance: number }[]; missTotal: number; varianceShare: number;
  value: { n: number; won: number; roi: number }; liveValue: { n: number; won: number; roi: number; clv: number | null; clvN: number };
  /** Siguran izbor sa dobrom kvotom: simulacija i uživo. */
  highlight: BetStat; liveHighlight: BetStat;
  /** Učinak predloženih uloga u simulaciji. */
  staking: { n: number; hit: number; pct: number; roi: number };
  byConfidence: { min: number; n: number; hit: number; pct: number; odds: number; roi: number }[];
  how: { games: number; groups: { group: string; share: number }[]; params: ParamInfo[]; weights: { name: string; weight: number }[] };
  /** Opklade se preporučuju tek kad papirni zapis dokaže plus. */
  betProven: boolean;
  importance: { group: string; share: number }[]; totals: { mae: number; marketMae: number | null; n: number };
}
export interface Lesson { key: string; label: string; n: number; expected: number; actual: number; z: number; adjust: number; active: boolean }
export interface TeamRow {
  id: number; abbr: string; name: string; w: number; l: number; elo: number; off: number; def: number; net: number; pace: number;
  efg: number; tov: number; orb: number; ftr: number; hit: number; picks: number;
}
export interface Miss { id: number; date: string; home: string; away: string; hs: number; as: number; pick: string; p: number; src: 'live' | 'test'; pm: Postmortem }
