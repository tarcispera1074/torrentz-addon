const axios = require('axios');
const cheerio = require('cheerio');
const { extractInfoHash, parseSizeToBytes } = require('../src/utils/parser');

async function testMirror() {
  const mirrors = [
    'https://thepiratebay.party',
    'https://thehiddenbay.com',
    'https://pirateproxy.live'
  ];

  for (const m of mirrors) {
    try {
      console.log(`Checking ${m}...`);
      const url = `${m}/search/Blair%20Williams/1/99/0`;
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 5000
      });

      const $ = cheerio.load(res.data);
      const items = [];

      $('table#searchResult tr').each((_, row) => {
        const titleAnchor = $(row).find('.detName a');
        const title = titleAnchor.text().trim();
        const magnet = $(row).find('a[href^="magnet:?"]').attr('href');
        const descText = $(row).find('font.detDesc').text() || '';
        const seedersText = $(row).find('td[align="right"]').first().text().trim();

        if (title && magnet) {
          const infoHash = extractInfoHash(magnet);
          const sizeMatch = descText.match(/Size\s+([\d.]+\s*[GMK]i?B)/i);
          const sizeBytes = sizeMatch ? parseSizeToBytes(sizeMatch[1]) : 0;
          const seeders = parseInt(seedersText, 10) || 0;

          items.push({
            title,
            infoHash,
            sizeBytes,
            seeders,
            source: 'ThePirateBay'
          });
        }
      });

      console.log(`✅ ${m} returned ${items.length} torrents!`);
      if (items.length > 0) {
        console.log('Sample item:', items[0]);
        return items;
      }
    } catch (e) {
      console.log(`❌ ${m} failed:`, e.message);
    }
  }
}

testMirror();
