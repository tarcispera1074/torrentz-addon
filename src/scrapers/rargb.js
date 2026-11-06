const cheerio = require('cheerio');
const { requestHtml } = require('../utils/http');
const { extractInfoHash, parseSizeToBytes } = require('../utils/parser');
const mirrors = require('../utils/mirrors');

const PRIMARY_MIRRORS = [
  'https://rargb.to',
  'https://rarbg.to'
];

async function searchRARBG(query) {
  const results = [];
  for (const domain of PRIMARY_MIRRORS) {
    if (!mirrors.canUse(domain)) continue;

    try {
      const url = `${domain}/search/?search=${encodeURIComponent(query)}`;
      const res = await requestHtml(url, { timeout: 3000 });
      if (!res.data || res.status !== 200) {
        mirrors.markFailure(domain);
        continue;
      }

      mirrors.markSuccess(domain);

      const $ = cheerio.load(res.data);
      $('table.lista2t tr.lista2').each((_, el) => {
        const row = $(el);
        const titleAnchor = row.find('td:nth-child(2) a').first();
        const rawTitle = titleAnchor.text().trim();
        const href = titleAnchor.attr('href') || '';
        if (!rawTitle) return;

        let infoHash = extractInfoHash(row.find('a[href^="magnet:?"]').attr('href'));
        if (!infoHash) {
          infoHash = href.match(/([a-fA-F0-9]{40})/)?.[1]?.toLowerCase();
        }

        const sizeText = row.find('td:nth-child(5)').text().trim();
        const seeders = parseInt(row.find('td:nth-child(6) font').text().trim() || row.find('td:nth-child(6)').text().trim(), 10) || 0;

        if (infoHash) {
          results.push({
            rawTitle,
            infoHash,
            sizeBytes: parseSizeToBytes(sizeText),
            seeders,
            source: 'RARBG'
          });
        }
      });

      if (results.length > 0) return results;
    } catch (e) {
      mirrors.markFailure(domain);
    }
  }
  return results;
}

module.exports = {
  name: 'RARBG',
  search: searchRARBG
};
