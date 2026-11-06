const { client } = require('../utils/http');
const { pollUntil, debridPollOptions } = require('../utils/poll');
const { DebridPendingError, DebridError } = require('./errors');

const API_BASE = 'https://www.premiumize.me/api';
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|wmv|m4v|webm|flv)$/i;

async function checkCache(apiKey, infoHashes) {
  if (!apiKey || !infoHashes || infoHashes.length === 0) return new Set();

  const cachedHashes = new Set();
  const chunkSize = 50;

  for (let i = 0; i < infoHashes.length; i += chunkSize) {
    const chunk = infoHashes.slice(i, i + chunkSize);
    try {
      const params = new URLSearchParams();
      params.append('apikey', apiKey);
      chunk.forEach(h => params.append('items[]', h));

      const res = await client.get(`${API_BASE}/cache/check?${params.toString()}`, { timeout: 5000 });
      if (res.data?.status === 'success' && Array.isArray(res.data?.response)) {
        res.data.response.forEach((isCached, idx) => {
          if (isCached && chunk[idx]) {
            cachedHashes.add(chunk[idx].toLowerCase());
          }
        });
      }
    } catch (err) {
      console.warn(`[Premiumize] Cache check error: ${err.message}`);
    }
  }

  return cachedHashes;
}

function pickVideo(content) {
  const videoFiles = (content || [])
    .filter(f => VIDEO_EXT.test(f.path || f.name || ''))
    .sort((a, b) => (b.size || 0) - (a.size || 0));
  return videoFiles[0] || null;
}

async function resolveStream(apiKey, infoHash) {
  const magnet = `magnet:?xt=urn:btih:${String(infoHash).toLowerCase()}`;

  // directdl only succeeds for cached content. Poll for the duration of the
  // wait budget so a torrent that is finishing caching can still resolve.
  const result = await pollUntil(async () => {
    try {
      const res = await client.post(
        `${API_BASE}/transfer/directdl`,
        new URLSearchParams({ apikey: apiKey, src: magnet }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 8000
        }
      );

      if (res.data?.status === 'success') {
        const file = pickVideo(res.data.content);
        if (file?.link) return file.link;
        if (Array.isArray(res.data.content) && res.data.content[0]?.link) {
          return res.data.content[0].link;
        }
      }

      const message = String(res.data?.message || '');
      if (/invalid (api ?key|token)|authentication|not premium|account/i.test(message)) {
        throw new DebridError('Premiumize', message || 'request rejected');
      }
      return null;
    } catch (err) {
      if (err.name === 'DebridError') throw err;
      return null;
    }
  }, debridPollOptions());

  if (!result) throw new DebridPendingError('Premiumize', 5);
  return result;
}

module.exports = {
  id: 'premiumize',
  name: 'Premiumize',
  checkCache,
  resolveStream
};
