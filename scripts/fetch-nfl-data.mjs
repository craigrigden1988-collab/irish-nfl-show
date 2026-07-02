/**
 * Irish NFL Show — Data Fetcher
 * Run by GitHub Actions daily. Fetches ESPN + nflverse data and saves
 * as static JSON/CSV files in /data, which Netlify serves as static assets.
 * The app reads /data/* first, falling back to live ESPN via the proxy.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';

const API  = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE = 'https://site.api.espn.com/apis/v2/sports/football/nfl';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; IrishNFLShow/1.0)',
  'Accept': 'application/json, text/plain, */*',
};

// ── Season detection ────────────────────────────────────────────────────────
// NFL season year = the year the season started (e.g. 2025 season runs Sept 2025 – Feb 2026)
function detectSeason() {
  if (process.env.OVERRIDE_SEASON) return parseInt(process.env.OVERRIDE_SEASON);
  const now = new Date();
  const month = now.getMonth() + 1; // 1–12
  const year  = now.getFullYear();
  // Jan/Feb belong to the previous year's season
  return month <= 2 ? year - 1 : year;
}

const SEASON = detectSeason();
console.log(`\n🏈  Irish NFL Show — Data Fetch`);
console.log(`📅  Season: ${SEASON}  |  ${new Date().toISOString()}\n`);

// ── Helpers ─────────────────────────────────────────────────────────────────
async function fetchJSON(label, url) {
  try {
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    console.log(`  ✓  ${label}`);
    return data;
  } catch(e) {
    console.error(`  ✗  ${label}: ${e.message}`);
    return null;
  }
}

async function fetchText(label, url) {
  try {
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    console.log(`  ✓  ${label} (${Math.round(text.length / 1024)}KB)`);
    return text;
  } catch(e) {
    console.error(`  ✗  ${label}: ${e.message}`);
    return null;
  }
}

// Only overwrite a file if we got good data — never blank out a working cache
function save(path, content) {
  if (!content) return;
  mkdirSync('data', { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
}

// Try a list of URLs in order, returning the first that works
async function fetchFirstWorking(label, urls) {
  for (const url of urls) {
    const result = await fetchText(label, url);
    if (result && result.length > 500) return result; // basic sanity check
  }
  return null;
}

// ── Fetch all data ───────────────────────────────────────────────────────────
async function main() {
  const meta = {
    generated_at: new Date().toISOString(),
    season: SEASON,
    endpoints: {}
  };

  // 1. Scores — current week (also discovers which week is live)
  console.log('Scores & schedule…');
  const liveScores = await fetchJSON('live scoreboard', `${API}/scoreboard`);
  if (liveScores) {
    save('data/scores.json', liveScores);
    meta.current_week = liveScores.week?.number;
    meta.endpoints.scores = true;

    // Also save each week's scoreboard for the current season (weeks 1–18)
    // This lets the app browse historical weeks from cache too
    const currentWeek = liveScores.week?.number || 1;
    const weeksToFetch = Math.min(currentWeek, 18);
    mkdirSync('data/weeks', { recursive: true });
    for (let w = 1; w <= weeksToFetch; w++) {
      const weekData = await fetchJSON(
        `week ${w} scoreboard`,
        `${API}/scoreboard?seasontype=2&week=${w}&season=${SEASON}`
      );
      if (weekData) save(`data/weeks/week_${w}.json`, weekData);
      // Small delay to be polite to ESPN
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // 2. Standings
  console.log('\nStandings…');
  const standings = await fetchJSON(
    'standings',
    `${CORE}/standings?level=3&season=${SEASON}&seasontype=2`
  );
  if (standings) {
    save('data/standings.json', standings);
    meta.endpoints.standings = true;
  }

  // 3. Teams (rarely changes — but good to keep fresh for record/logo accuracy)
  console.log('\nTeams…');
  const teams = await fetchJSON('teams', `${API}/teams?limit=32`);
  if (teams) {
    save('data/teams.json', teams);
    meta.endpoints.teams = true;
  }

  // 4. Injuries — fetch per team and combine into one file
  console.log('\nInjuries…');
  if (teams) {
    const teamList = (teams.sports?.[0]?.leagues?.[0]?.teams || []).map(t => t.team);
    const allInjuries = {};
    for (const team of teamList) {
      const abbr = team.abbreviation;
      const data = await fetchJSON(`injuries — ${abbr}`, `${API}/teams/${abbr}/injuries`);
      if (data) allInjuries[abbr] = data;
      await new Promise(r => setTimeout(r, 150));
    }
    save('data/injuries.json', allInjuries);
    meta.endpoints.injuries = true;
  }

  // 5. nflverse — historical H2H games CSV
  console.log('\nnflverse games history…');
  const gamesCSV = await fetchText(
    'games.csv',
    'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
  );
  if (gamesCSV) {
    save('data/games.csv', gamesCSV);
    meta.endpoints.games_csv = true;
  }

  // 6. nflverse — current season player stats (offense + defense)
  //    Tries multiple URL patterns since nflverse restructures occasionally
  console.log('\nnflverse player stats…');
  const offenseUrls = [
    `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${SEASON}.csv`,
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${SEASON}.csv`,
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_season_${SEASON}.csv`,
  ];
  const offenseCSV = await fetchFirstWorking('player stats (offense)', offenseUrls);
  if (offenseCSV) {
    save(`data/player_stats_offense_${SEASON}.csv`, offenseCSV);
    meta.endpoints.player_stats_offense = true;
  }

  const defenseUrls = [
    `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_def_${SEASON}.csv`,
    `https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_season_def_${SEASON}.csv`,
  ];
  const defenseCSV = await fetchFirstWorking('player stats (defense)', defenseUrls);
  if (defenseCSV) {
    save(`data/player_stats_defense_${SEASON}.csv`, defenseCSV);
    meta.endpoints.player_stats_defense = true;
  }

  // 7. Write meta file — app reads this to know when data was last refreshed
  save('data/meta.json', meta);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅  Done. Season ${SEASON}, week ${meta.current_week || '?'}`);
  console.log(`    Generated at: ${meta.generated_at}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
