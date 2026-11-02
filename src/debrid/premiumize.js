const axios = require('axios');

const API_BASE = 'https://www.premiumize.me/api';

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

      const res = await axios.get(`${API_BASE}/cache/check?${params.toString()}`, { timeout: 5000 });
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

async function resolveStream(apiKey, infoHash) {
  const magnet = `magnet:?xt=urn:btih:${infoHash}`;
  
  // Use direct download if available
  const res = await axios.post(`${API_BASE}/transfer/directdl`, new URLSearchParams({
    apikey: apiKey,
    src: magnet
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 8000
  });

  const content = res.data?.content || [];
  const videoFiles = content
    .filter(f => /\.(mp4|mkv|avi|mov|wmv)$/i.test(f.path || ''))
    .sort((a, b) => (b.size || 0) - (a.size || 0));

  if (videoFiles.length > 0 && videoFiles[0].link) {
    return videoFiles[0].link;
  }

  throw new Error('Premiumize: No direct video stream found');
}

module.exports = {
  id: 'premiumize',
  name: 'Premiumize',
  checkCache,
  resolveStream
};
