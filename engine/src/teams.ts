export interface Team { id: number; abbr: string; name: string; lat: number; lon: number; alt: number; tz: number }

// [ESPN id, skraćenica, ime, geografska širina, dužina, nadmorska visina (m), UTC pomeraj]
const RAW: [number, string, string, number, number, number, number][] = [
  [1, 'ATL', 'Atlanta Hawks', 33.757, -84.396, 320, -5],
  [2, 'BOS', 'Boston Celtics', 42.366, -71.062, 5, -5],
  [3, 'NO', 'New Orleans Pelicans', 29.949, -90.082, 2, -6],
  [4, 'CHI', 'Chicago Bulls', 41.881, -87.674, 181, -6],
  [5, 'CLE', 'Cleveland Cavaliers', 41.497, -81.688, 200, -5],
  [6, 'DAL', 'Dallas Mavericks', 32.79, -96.81, 131, -6],
  [7, 'DEN', 'Denver Nuggets', 39.749, -105.008, 1609, -7],
  [8, 'DET', 'Detroit Pistons', 42.341, -83.055, 183, -5],
  [9, 'GS', 'Golden State Warriors', 37.768, -122.388, 3, -8],
  [10, 'HOU', 'Houston Rockets', 29.751, -95.362, 13, -6],
  [11, 'IND', 'Indiana Pacers', 39.764, -86.156, 218, -5],
  [12, 'LAC', 'LA Clippers', 33.945, -118.343, 30, -8],
  [13, 'LAL', 'Los Angeles Lakers', 34.043, -118.267, 87, -8],
  [14, 'MIA', 'Miami Heat', 25.781, -80.187, 2, -5],
  [15, 'MIL', 'Milwaukee Bucks', 43.045, -87.917, 188, -6],
  [16, 'MIN', 'Minnesota Timberwolves', 44.979, -93.276, 253, -6],
  [17, 'BKN', 'Brooklyn Nets', 40.683, -73.975, 15, -5],
  [18, 'NY', 'New York Knicks', 40.751, -73.993, 10, -5],
  [19, 'ORL', 'Orlando Magic', 28.539, -81.384, 30, -5],
  [20, 'PHI', 'Philadelphia 76ers', 39.901, -75.172, 6, -5],
  [21, 'PHX', 'Phoenix Suns', 33.446, -112.071, 331, -7],
  [22, 'POR', 'Portland Trail Blazers', 45.532, -122.667, 15, -8],
  [23, 'SAC', 'Sacramento Kings', 38.58, -121.5, 9, -8],
  [24, 'SA', 'San Antonio Spurs', 29.427, -98.438, 198, -6],
  [25, 'OKC', 'Oklahoma City Thunder', 35.463, -97.515, 366, -6],
  [26, 'UTAH', 'Utah Jazz', 40.768, -111.901, 1288, -7],
  [27, 'WSH', 'Washington Wizards', 38.898, -77.021, 12, -5],
  [28, 'TOR', 'Toronto Raptors', 43.643, -79.379, 76, -5],
  [29, 'MEM', 'Memphis Grizzlies', 35.138, -90.051, 103, -6],
  [30, 'CHA', 'Charlotte Hornets', 35.225, -80.839, 229, -5],
];

export const TEAMS = new Map<number, Team>(
  RAW.map(([id, abbr, name, lat, lon, alt, tz]) => [id, { id, abbr, name, lat, lon, alt, tz }]),
);
export const isNbaTeam = (id: number) => TEAMS.has(id);
export const team = (id: number): Team => TEAMS.get(id)!;

/** Vazdušna udaljenost između dva grada (km). */
export function km(a: Team, b: Team): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
