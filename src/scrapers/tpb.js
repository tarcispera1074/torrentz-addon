const cheerio = require('cheerio');
const { client, requestHtml } = require('../utils/http');
const { extractInfoHash, parseSizeToBytes } = require('../utils/parser');
const mirrors = require('../utils/mirrors');

const TPB_MIRRORS = [
  'https://thehiddenbay.com',
  'https://thepiratebay.party',
  'https://pirateproxy.live'
];

/**
 * Scrape The Pirate Bay using mirrors with Apibay fallback
 */
async function searchThePirateBay(query) {
  const results = [];

  // 1. Try HTML Mirrors (Bypasses Cloudflare block on datacenter IPs like Render)
  for (const mirror of TPB_MIRRORS) {
    if (!mirrors.canUse(mirror)) continue;

    try {
      const url = `${mirror}/search/${encodeURIComponent(query)}/1/99/0`;
      const res = await requestHtml(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        timeout: 4500
      });

      if (res.status === 200 && typeof res.data === 'string' && res.data.includes('searchResult')) {
        mirrors.markSuccess(mirror);

        const $ = cheerio.load(res.data);
        $('table#searchResult tr').each((_, row) => {
          const titleAnchor = $(row).find('.detName a');
          const rawTitle = titleAnchor.text().trim();
          const magnet = $(row).find('a[href^="magnet:?"]').attr('href');
          const descText = $(row).find('font.detDesc').text() || '';
          const seedersText = $(row).find('td[align="right"]').first().text().trim();

          if (rawTitle && magnet) {
            const infoHash = extractInfoHash(magnet);
            if (infoHash) {
              const sizeMatch = descText.match(/Size\s+([\d.]+\s*[GMK]i?B)/i);
              const sizeBytes = sizeMatch ? parseSizeToBytes(sizeMatch[1]) : 0;
              const seeders = parseInt(seedersText, 10) || 0;

              results.push({
                rawTitle,
                infoHash,
                sizeBytes,
                seeders,
                source: 'ThePirateBay'
              });
            }
          }
        });

        if (results.length > 0) {
          console.log(`[TPB] Found ${results.length} results from ${mirror}`);
          return results;
        }
      } else {
        mirrors.markFailure(mirror);
      }
    } catch (err) {
      mirrors.markFailure(mirror);
      // Try next mirror
    }
  }

  // 2. Fallback to Apibay API (works on residential IPs)
  try {
    const url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}`;
    const res = await client.get(url, { timeout: 4000 });
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
    // Apibay failed
  }

  return results;
}

module.exports = {
  name: 'ThePirateBay',
  search: searchThePirateBay
};
