const cheerio = require('cheerio');
const { requestHtml } = require('../utils/http');
const { extractInfoHash, parseSizeToBytes } = require('../utils/parser');
const mirrors = require('../utils/mirrors');

const PRIMARY_MIRRORS = [
  'https://www.limetorrents.fun',
  'https://www.limetorrents.lol'
];

async function searchLimeTorrents(query) {
  const results = [];
  for (const domain of PRIMARY_MIRRORS) {
    if (!mirrors.canUse(domain)) continue;

    try {
      const url = `${domain}/search/all/${encodeURIComponent(query)}/`;
      const res = await requestHtml(url, { timeout: 3000 });
      if (!res.data || res.status !== 200) {
        mirrors.markFailure(domain);
        continue;
      }

      mirrors.markSuccess(domain);

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

        // LimeTorrents commonly exposes a direct .torrent download link whose
        // URL contains the info hash, rather than an inline magnet link.
        if (!infoHash) {
          row.find('a[href]').each((_, anchor) => {
            if (infoHash) return;
            const downloadHref = $(anchor).attr('href') || '';
            if (!/\.torrent(?:[?#]|$)/i.test(downloadHref)) return;
            infoHash = downloadHref.match(/([a-fA-F0-9]{40})/)?.[1]?.toLowerCase() || null;
          });
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
    } catch (e) {
      mirrors.markFailure(domain);
    }
  }
  return results;
}

module.exports = {
  name: 'LimeTorrents',
  search: searchLimeTorrents
};
