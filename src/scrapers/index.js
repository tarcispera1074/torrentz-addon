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
const sukebei = require('./sukebei');
const tokyotosho = require('./tokyotosho');
const ffjav = require('./ffjav');

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
  pornrips,
  sukebei,
  tokyotosho,
  ffjav,
};

const DEFAULT_SEARCH_TIMEOUT_MS = 8000;
const inFlightSearches = new Map();

/**
 * Resolve after `ms` even if the scrape is still running. Slow providers must
 * never hold the whole addon response past the client timeout.
 */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });

  return Promise.race([
    promise.then(value => ({ value }), error => ({ error })),
    timeout
  ]).finally(() => clearTimeout(timer));
}

function resolveScrapers(enabledProviders) {
  const active = [];

  for (const p of enabledProviders) {
    const key = String(p).toLowerCase().trim();
    const scraper = SCRAPERS[key];
    if (scraper && !active.some(entry => entry.scraper === scraper)) {
      active.push({ id: scraper.id || key, scraper });
    }
  }

  if (active.length === 0) {
    // Default to all if none matched
    for (const [id, scraper] of Object.entries(SCRAPERS)) {
      if (!active.some(entry => entry.scraper === scraper)) {
        active.push({ id: scraper.id || id, scraper });
      }
    }
  }

  return active;
}

/**
 * Run searches across requested providers in parallel.
 *
 * Concurrency is bounded by one shared deadline so a blocked provider (login
 * wall, Cloudflare, slow detail-page crawl) cannot stall catalog/stream
 * requests. Results from providers that answer in time are always returned.
 *
 * @param {string} query - The search query
 * @param {Array<string>} enabledProviders - List of provider IDs, e.g. ['tpb', '1337x']
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Array>} List of deduplicated torrent objects
 */
async function searchAll(query, enabledProviders = ['tpb', '1337x', 'limetorrents', 'rargb'], options = {}) {
  const active = resolveScrapers(enabledProviders || []);
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1000, Math.min(20000, options.timeoutMs))
    : DEFAULT_SEARCH_TIMEOUT_MS;

  const cacheKey = `${String(query).trim().toLowerCase()}|${active.map(e => e.id).sort().join(',')}`;
  const existing = inFlightSearches.get(cacheKey);
  if (existing) return existing;

  const run = (async () => {
    const outcomes = await Promise.all(
      active.map(async ({ id, scraper }) => {
        const outcome = await withTimeout(Promise.resolve().then(() => scraper.search(query)), timeoutMs);
        if (outcome.timedOut) {
          console.warn(`[Search] ${id} timed out after ${timeoutMs}ms`);
          return null;
        }
        if (outcome.error) {
          console.warn(`[Search] ${id} failed: ${outcome.error.message}`);
          return null;
        }
        return outcome.value;
      })
    );

    const torrentMap = new Map();

    for (const value of outcomes) {
      if (!Array.isArray(value)) continue;
      for (const torrent of value) {
        if (!torrent.infoHash) continue;
        const hash = torrent.infoHash.toLowerCase();

        // Deduplicate: if already seen, retain highest seeders
        if (torrentMap.has(hash)) {
          const current = torrentMap.get(hash);
          if (torrent.seeders > current.seeders) {
            torrentMap.set(hash, torrent);
          }
        } else {
          torrentMap.set(hash, torrent);
        }
      }
    }

    // Convert to array and sort by seeders descending
    const list = Array.from(torrentMap.values());
    list.sort((a, b) => b.seeders - a.seeders);
    return list;
  })();

  inFlightSearches.set(cacheKey, run);
  try {
    return await run;
  } finally {
    inFlightSearches.delete(cacheKey);
  }
}

module.exports = {
  SCRAPERS,
  searchAll
};
