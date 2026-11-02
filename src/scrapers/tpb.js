const { client } = require('../utils/http');
const { extractInfoHash } = require('../utils/parser');

/**
 * Scrape The Pirate Bay using the official Apibay API
 */
async function searchThePirateBay(query) {
  const results = [];
  try {
    // Omitting cat allows searching all video and media categories
    const url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}`;
    const res = await client.get(url, { timeout: 6000 });

    if (Array.isArray(res.data)) {
      for (const item of res.data) {
        if (!item || !item.name || item.name === 'No results returned') continue;
        const infoHash = extractInfoHash(item.info_hash);
        if (!infoHash) continue;

        results.push({
          rawTitle: item.name,
          infoHash: infoHash,
          sizeBytes: parseInt(item.size, 10) || 0,
          seeders: parseInt(item.seeders, 10) || 0,
          source: 'ThePirateBay'
        });
      }
    }
  } catch (err) {
    console.warn(`[TPB] Search error for "${query}": ${err.message}`);
  }

  return results;
}

module.exports = {
  name: 'ThePirateBay',
  search: searchThePirateBay
};
