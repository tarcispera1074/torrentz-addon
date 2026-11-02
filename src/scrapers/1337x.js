const cheerio = require('cheerio');
const { client } = require('../utils/http');
const { extractInfoHash, parseSizeToBytes } = require('../utils/parser');

const MIRRORS = [
  'https://1337x.to',
  'https://1337x.st',
  'https://1337x.ws',
  'https://x1337x.ws',
  'https://1337x.so'
];

async function fetchMagnetFromDetailPage(domain, detailPath) {
  try {
    const fullUrl = `${domain}${detailPath}`;
    const res = await client.get(fullUrl, { timeout: 4000 });
    const $ = cheerio.load(res.data);
    const magnet = $('a[href^="magnet:?"]').first().attr('href');
    if (magnet) {
      return extractInfoHash(magnet);
    }
    const hashMatch = res.data.match(/([a-fA-F0-9]{40})/);
    if (hashMatch) {
      return hashMatch[1].toLowerCase();
    }
  } catch (err) {
    // Detail timeout/error
  }
  return null;
}

async function search1337x(query) {
  const results = [];

  for (const domain of MIRRORS) {
    const searchUrl = `${domain}/search/${encodeURIComponent(query)}/1/`;
    try {
      const res = await client.get(searchUrl, { timeout: 4500 });
      if (!res.data || res.status !== 200) continue;

      const $ = cheerio.load(res.data);
      const candidateRows = [];

      $('table.table-list tbody tr').each((_, el) => {
        const row = $(el);
        const titleLink = row.find('td.coll-1 a:nth-child(2)');
        const rawTitle = titleLink.text().trim();
        const href = titleLink.attr('href');
        const seeders = parseInt(row.find('td.coll-2').text().trim(), 10) || 0;
        const sizeText = row.find('td.coll-4').contents().first().text().trim() || row.find('td.coll-4').text().trim();

        if (rawTitle && href) {
          candidateRows.push({
            rawTitle,
            href,
            seeders,
            sizeBytes: parseSizeToBytes(sizeText)
          });
        }
      });

      if (candidateRows.length > 0) {
        candidateRows.sort((a, b) => b.seeders - a.seeders);
        const topCandidates = candidateRows.slice(0, 8);

        await Promise.allSettled(
          topCandidates.map(async (item) => {
            const infoHash = await fetchMagnetFromDetailPage(domain, item.href);
            if (infoHash) {
              results.push({
                rawTitle: item.rawTitle,
                infoHash,
                sizeBytes: item.sizeBytes,
                seeders: item.seeders,
                source: '1337x'
              });
            }
          })
        );

        if (results.length > 0) {
          return results;
        }
      }
    } catch (err) {
      // Try next mirror
    }
  }

  return results;
}

module.exports = {
  name: '1337x',
  search: search1337x
};
