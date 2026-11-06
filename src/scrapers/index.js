const tpb = require('./tpb');
const x1337 = require('./1337x');
const limetorrents = require('./limetorrents');
const rargb = require('./rargb');
const torlock = require('./torlock');
const pussytorrents = require('./pussytorrents');
const yourbittorrent2 = require('./yourbittorrent2');
const bootytape = require('./bootytape');
const mypornclub = require('./mypornclub');
const lovetorrent = require('./lovetorrent');
const xxxclub = require('./xxxclub');
const pornrips = require('./pornrips');

const SCRAPERS = {
  thepiratebay: tpb,
  tpb: tpb,
  '1337x': x1337,
  limetorrents: limetorrents,
  rargb: rargb,
  torlock,
  pussytorrents,
  yourbittorrent2,
  bootytape,
  mypornclub,
  lovetorrent,
  xxxclub,
  pornrips
};

/**
 * Run searches across requested providers in parallel
 * 
 * @param {string} query - The search query
 * @param {Array<string>} enabledProviders - List of provider IDs, e.g. ['tpb', '1337x']
 * @returns {Promise<Array>} List of deduplicated torrent objects
 */
async function searchAll(query, enabledProviders = ['tpb', '1337x', 'limetorrents', 'rargb']) {
  const activeScrapers = [];

  for (const p of enabledProviders) {
    const key = String(p).toLowerCase().trim();
    if (SCRAPERS[key] && !activeScrapers.includes(SCRAPERS[key])) {
      activeScrapers.push(SCRAPERS[key]);
    }
  }

  if (activeScrapers.length === 0) {
    // Default to all if none matched
    for (const scraper of Object.values(SCRAPERS)) {
      if (!activeScrapers.includes(scraper)) activeScrapers.push(scraper);
    }
  }

  // Execute in parallel with Promise.allSettled
  const resultsByScraper = await Promise.allSettled(
    activeScrapers.map(scraper => scraper.search(query))
  );

  const torrentMap = new Map();

  for (const outcome of resultsByScraper) {
    if (outcome.status === 'fulfilled' && Array.isArray(outcome.value)) {
      for (const torrent of outcome.value) {
        if (!torrent.infoHash) continue;
        const hash = torrent.infoHash.toLowerCase();

        // Deduplicate: if already seen, retain highest seeders
        if (torrentMap.has(hash)) {
          const existing = torrentMap.get(hash);
          if (torrent.seeders > existing.seeders) {
            torrentMap.set(hash, torrent);
          }
        } else {
          torrentMap.set(hash, torrent);
        }
      }
    }
  }

  // Convert to array and sort by seeders descending
  const list = Array.from(torrentMap.values());
  list.sort((a, b) => b.seeders - a.seeders);
  return list;
}

module.exports = {
  SCRAPERS,
  searchAll
};
