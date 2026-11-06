const crypto = require('crypto');
const { client, requestHtml } = require('../utils/http');
const { extractInfoHash, parseSizeToBytes } = require('../utils/parser');

async function search(query) {
  try {
    const response = await requestHtml(`https://pornrips.to/feed/?s=${encodeURIComponent(query)}`, { timeout: 9000 });
    if (response.status !== 200 || typeof response.data !== 'string') return [];

    const results = [];
    const items = response.data.split(/<item>/i).slice(1);
    for (const item of items) {
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || item.match(/<title>(.*?)<\/title>/i) || [])[1];
      const links = [...item.matchAll(/https?:\/\/[^\s<>"']+\.torrent/gi)];
      for (const match of links) {
        let infoHash = null;
        try {
          const torrent = await client.get(match[0], { responseType: 'arraybuffer', timeout: 9000 });
          infoHash = torrentInfoHash(Buffer.from(torrent.data));
        } catch (err) {
          // A missing torrent file should not make the feed search fail.
        }
        if (!infoHash) continue;
        const sizeText = item.match(/File Size:<\/strong>\s*([\d.]+\s*[GMK]B)/i);
        results.push({
          rawTitle: title || 'PornRips release',
          infoHash,
          sizeBytes: sizeText ? parseSizeToBytes(sizeText[1]) : 0,
          seeders: 0,
          source: 'PornRips'
        });
      }
    }
    return results;
  } catch (err) {
    return [];
  }
}

// Torrent files hash the bencoded `info` dictionary, not the whole file.
function torrentInfoHash(bytes) {
  function value(offset) {
    const start = offset;
    const char = String.fromCharCode(bytes[offset]);
    if (char === 'i') {
      offset += 1;
      while (bytes[offset] !== 101) offset += 1;
      return { end: offset + 1 };
    }
    if (char === 'l') {
      offset += 1;
      while (bytes[offset] !== 101) offset = value(offset).end;
      return { end: offset + 1 };
    }
    if (char === 'd') {
      offset += 1;
      while (bytes[offset] !== 101) {
        const key = value(offset);
        offset = key.end;
        offset = value(offset).end;
      }
      return { end: offset + 1 };
    }
    const colon = bytes.indexOf(58, offset);
    const length = parseInt(Buffer.from(bytes.subarray(offset, colon)).toString(), 10);
    return { end: colon + 1 + length };
  }

  if (bytes[0] !== 100) return null;
  let offset = 1;
  while (bytes[offset] !== 101) {
    const keyStart = offset;
    const key = value(offset);
    offset = key.end;
    const keyText = Buffer.from(bytes.subarray(keyStart, key.end)).toString();
    const infoStart = offset;
    const info = value(offset);
    offset = info.end;
    if (keyText === '4:info') {
      return crypto.createHash('sha1').update(Buffer.from(bytes.subarray(infoStart, info.end))).digest('hex');
    }
  }
  return null;
}

module.exports = { id: 'pornrips', name: 'PornRips', search, torrentInfoHash };
