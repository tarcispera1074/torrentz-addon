const cheerio = require('cheerio');
const { client } = require('../utils/http');
const { extractInfoHash, parseSizeToBytes } = require('../utils/parser');

const PRIMARY_MIRRORS = [
  'https://1337x.to',
  'https://1337x.st',
  'https://1337x.ws'
];

async function search1337x(query) {
  const results = [];
  // Try fastest mirror first with quick 3s timeout
  for (const domain of PRIMARY_MIRRORS) {
    try {
      const searchUrl = `${domain}/search/${encodeURIComponent(query)}/1/`;
      const res = await client.get(searchUrl, { timeout: 3000 });
      if (!res.data || res.status !== 200) continue;

      const $ = cheerio.load(res.data);
      const rows = $('table.table-list tbody tr');
      if (rows.length === 0) continue;

      const topRows = [];
      rows.each((_, el) => {
        if (topRows.length >= 6) return false;
        const row = $(el);
        const titleLink = row.find('td.coll-1 a:nth-child(2)');
        const rawTitle = titleLink.text().trim();
        const href = titleLink.attr('href');
        const seeders = parseInt(row.find('td.coll-2').text().trim(), 10) || 0;
        const sizeText = row.find('td.coll-4').text().trim();

        if (rawTitle && href) {
          topRows.push({ rawTitle, href, seeders, sizeBytes: parseSizeToBytes(sizeText) });
        }
      });

      // Quick fetch of magnets
      await Promise.allSettled(
        topRows.map(async (item) => {
          try {
            const detailRes = await client.get(`${domain}${item.href}`, { timeout: 2500 });
            const magnet = detailRes.data?.match(/magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40}/i)?.[0];
            const hash = extractInfoHash(magnet);
            if (hash) {
              results.push({
                rawTitle: item.rawTitle,
                infoHash: hash,
                sizeBytes: item.sizeBytes,
                seeders: item.seeders,
                source: '1337x'
              });
            }
          } catch (e) {}
        })
      );

      if (results.length > 0) return results;
    } catch (e) {
      // Move to next mirror
    }
  }

  return results;
}

module.exports = {
  name: '1337x',
  search: search1337x
};
