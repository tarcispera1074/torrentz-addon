const axios = require('axios');

const API_BASE = 'https://api.torbox.app/v1/api';

async function checkCache(apiKey, infoHashes) {
  if (!apiKey || !infoHashes || infoHashes.length === 0) return new Set();

  const cachedHashes = new Set();
  try {
    const hashesParam = infoHashes.join(',');
    const url = `${API_BASE}/torrents/checkcached?hash=${hashesParam}&format=list`;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 5000
    });

    if (res.data?.success && Array.isArray(res.data?.data)) {
      res.data.data.forEach(item => {
        if (item.hash) {
          cachedHashes.add(item.hash.toLowerCase());
        }
      });
    }
  } catch (err) {
    console.warn(`[TorBox] Cache check error: ${err.message}`);
  }

  return cachedHashes;
}

async function resolveStream(apiKey, infoHash) {
  const headers = { Authorization: `Bearer ${apiKey}` };

  // 1. Create torrent entry
  const createRes = await axios.post(`${API_BASE}/torrents/createtorrent`, {
    magnet: `magnet:?xt=urn:btih:${infoHash}`
  }, { headers, timeout: 8000 });

  const torrentId = createRes.data?.data?.torrent_id;
  if (!torrentId) throw new Error('TorBox: Failed to add torrent');

  // 2. Request download link
  const dlRes = await axios.get(`${API_BASE}/torrents/requestdl?token=${apiKey}&torrent_id=${torrentId}`, {
    headers,
    timeout: 8000
  });

  return dlRes.data?.data || null;
}

module.exports = {
  id: 'torbox',
  name: 'TorBox',
  checkCache,
  resolveStream
};
