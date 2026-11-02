const { client } = require('../utils/http');
const cache = require('../utils/cache');

/**
 * Resolve an IMDb ID (and optional season/episode) into human-readable titles for searching.
 * Cinemeta is Stremio's official metadata catalog.
 * 
 * @param {string} type - 'movie' or 'series'
 * @param {string} id - 'tt1375666' or 'tt0903747:1:1'
 */
async function getMetadata(type, id) {
  const parts = id.split(':');
  const imdbId = parts[0];
  const season = parts[1] ? parseInt(parts[1], 10) : null;
  const episode = parts[2] ? parseInt(parts[2], 10) : null;

  const cacheKey = `meta:${type}:${imdbId}`;
  let meta = cache.get(cacheKey);

  if (!meta) {
    try {
      const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
      const res = await client.get(url, { timeout: 6000 });
      if (res.data && res.data.meta) {
        meta = res.data.meta;
        cache.set(cacheKey, meta, 24 * 60 * 60 * 1000); // 24 hours
      }
    } catch (err) {
      console.warn(`[Cinemeta] Failed to fetch meta for ${id}: ${err.message}`);
    }
  }

  if (!meta || !meta.name) {
    return null;
  }

  // Construct standard search queries
  let query = meta.name;
  let year = meta.year ? parseInt(meta.year, 10) : null;

  // Handle series season/episode formatting
  let episodeQuery = null;
  if (type === 'series' && season !== null && episode !== null) {
    const s = String(season).padStart(2, '0');
    const e = String(episode).padStart(2, '0');
    episodeQuery = `S${s}E${e}`;
  }

  return {
    imdbId,
    type,
    name: meta.name,
    year,
    season,
    episode,
    episodeQuery,
    // e.g. "Inception 2010" or "Breaking Bad S01E01"
    searchQuery: episodeQuery ? `${meta.name} ${episodeQuery}` : (year ? `${meta.name} ${year}` : meta.name)
  };
}

module.exports = {
  getMetadata
};
