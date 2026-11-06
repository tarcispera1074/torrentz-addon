const { client } = require('../utils/http');
const { extractInfoHash, parseSizeToBytes } = require('../utils/parser');

async function search(query) {
  try {
    const response = await client.get(
      `https://www.tokyotosho.info/rss.php?terms=${encodeURIComponent(query)}`,
      { timeout: 9000, responseType: 'text' }
    );
    const xml = String(response.data || '');
    const results = [];
    for (const item of xml.split(/<item>/i).slice(1)) {
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]>/i) || item.match(/<title>(.*?)<\/title>/i) || [])[1];
      const magnet = (item.match(/magnet:\?xt=urn:btih:[^<\s]+/i) || [])[0];
      const infoHash = extractInfoHash(magnet);
      if (!infoHash) continue;
      const size = (item.match(/([\d.]+\s*(?:GB|GiB|MB|MiB))/i) || [])[1];
      results.push({
        rawTitle: title || 'Tokyo Toshokan release',
        infoHash,
        sizeBytes: size ? parseSizeToBytes(size) : 0,
        seeders: 0,
        source: 'Tokyo Toshokan'
      });
    }
    return results;
  } catch (err) {
    return [];
  }
}

module.exports = { id: 'tokyotosho', name: 'Tokyo Toshokan', search };
