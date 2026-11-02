const cheerio = require('cheerio');
const { client } = require('../utils/http');
const { extractInfoHash, parseSizeToBytes } = require('../utils/parser');

const PRIMARY_MIRRORS = [
  'https://www.limetorrents.fun',
  'https://www.limetorrents.lol'
];

async function searchLimeTorrents(query) {
  const results = [];
  for (const domain of PRIMARY_MIRRORS) {
    try {
      const url = `${domain}/search/all/${encodeURIComponent(query)}/`;
      const res = await client.get(url, { timeout: 3000 });
      if (!res.data || res.status !== 200) continue;

      const $ = cheerio.load(res.data);
      $('table.table2 tr').each((_, el) => {
        const row = $(el);
        const nameAnchor = row.find('.tt-name a').last();
        const rawTitle = nameAnchor.text().trim();
        const href = nameAnchor.attr('href') || '';
        if (!rawTitle || !href) return;

        let infoHash = href.match(/torrent-([a-fA-F0-9]{40})/i)?.[1]?.toLowerCase();
        const magnetHref = row.find('a[href^="magnet:?"]').attr('href');
        if (magnetHref) {
          infoHash = extractInfoHash(magnetHref) || infoHash;
        }

        const sizeText = row.find('td.tdnormal').eq(1).text().trim();
        const seeders = parseInt(row.find('td.tdseed').text().trim(), 10) || 0;

        if (infoHash) {
          results.push({
            rawTitle,
            infoHash,
            sizeBytes: parseSizeToBytes(sizeText),
            seeders,
            source: 'LimeTorrents'
          });
        }
      });

      if (results.length > 0) return results;
    } catch (e) {}
  }
  return results;
}

module.exports = {
  name: 'LimeTorrents',
  search: searchLimeTorrents
};
