const cheerio = require('cheerio');
const { requestHtml } = require('../utils/http');
const { extractInfoHash, parseSizeToBytes } = require('../utils/parser');
const mirrors = require('../utils/mirrors');

const PRIMARY_MIRRORS = [
  'https://1337x.to',
  'https://1337x.st',
  'https://1337x.ws'
];

async function search1337x(query) {
  const results = [];

  // Give mirrors and the optional challenge solver time to return a page.
  for (const domain of PRIMARY_MIRRORS) {
    if (!mirrors.canUse(domain)) continue;

    try {
      const searchUrl = `${domain}/search/${encodeURIComponent(query)}/1/`;
      const res = await requestHtml(searchUrl, { timeout: 8000 });
      if (!res.data || res.status !== 200) {
        mirrors.markFailure(domain);
        continue;
      }

      mirrors.markSuccess(domain);

      const $ = cheerio.load(res.data);
      const rows = $('table.table-list tbody tr');
      if (rows.length === 0) {
        if (/loading|checking your browser|verify you are human|cloudflare/i.test($.text())) {
          mirrors.markFailure(domain);
        }
        continue;
      }

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
            const detailRes = await requestHtml(`${domain}${item.href}`, { timeout: 6000 });
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
      mirrors.markFailure(domain);
      // Move to next mirror
    }
  }

  return results;
}

module.exports = {
  name: '1337x',
  search: search1337x
};
