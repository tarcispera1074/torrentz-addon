const axios = require('axios');

const API_BASE = 'https://debrid-link.com/api/v2';

async function checkCache(apiKey, infoHashes) {
  if (!apiKey || !infoHashes || infoHashes.length === 0) return new Set();

  const cachedHashes = new Set();
  try {
    const res = await axios.get(`${API_BASE}/seedbox/cached?url=${infoHashes.join(',')}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 5000
    });

    if (res.data?.success && res.data?.value) {
      for (const [hash, isCached] of Object.entries(res.data.value)) {
        if (isCached) {
          cachedHashes.add(hash.toLowerCase());
        }
      }
    }
  } catch (err) {
    console.warn(`[DebridLink] Cache check error: ${err.message}`);
  }

  return cachedHashes;
}

async function resolveStream(apiKey, infoHash) {
  const headers = { Authorization: `Bearer ${apiKey}` };

  const addRes = await axios.post(`${API_BASE}/seedbox/add`, {
    url: `magnet:?xt=urn:btih:${infoHash}`,
    async: false
  }, { headers, timeout: 8000 });

  const files = addRes.data?.value?.files || [];
  const videoFiles = files
    .filter(f => /\.(mp4|mkv|avi|mov|wmv)$/i.test(f.name || ''))
    .sort((a, b) => (b.size || 0) - (a.size || 0));

  if (videoFiles.length > 0 && videoFiles[0].downloadUrl) {
    return videoFiles[0].downloadUrl;
  }

  throw new Error('Debrid-Link: No streamable link found');
}

module.exports = {
  id: 'debridlink',
  name: 'Debrid-Link',
  checkCache,
  resolveStream
};
