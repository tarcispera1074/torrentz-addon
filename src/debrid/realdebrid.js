const axios = require('axios');

const API_BASE = 'https://api.real-debrid.com/rest/1.0';

/**
 * Check which infohashes are instantly available (cached) on Real-Debrid
 */
async function checkCache(apiKey, infoHashes) {
  if (!apiKey || !infoHashes || infoHashes.length === 0) return new Set();

  const cachedHashes = new Set();
  const chunkSize = 50; // RD allows batching hashes in URL
  const chunks = [];

  for (let i = 0; i < infoHashes.length; i += chunkSize) {
    chunks.push(infoHashes.slice(i, i + chunkSize));
  }

  for (const chunk of chunks) {
    try {
      const url = `${API_BASE}/torrents/instantAvailability/${chunk.join('/')}`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 5000
      });

      if (res.data) {
        for (const [hash, val] of Object.entries(res.data)) {
          if (val && Array.isArray(val.rd) && val.rd.length > 0) {
            cachedHashes.add(hash.toLowerCase());
          }
        }
      }
    } catch (err) {
      console.warn(`[RealDebrid] Cache check error: ${err.message}`);
    }
  }

  return cachedHashes;
}

/**
 * Resolve torrent hash to a direct streamable HTTP URL
 */
async function resolveStream(apiKey, infoHash) {
  const headers = { Authorization: `Bearer ${apiKey}` };

  // 1. Add magnet to Real-Debrid
  const magnet = `magnet:?xt=urn:btih:${infoHash}`;
  const addRes = await axios.post(`${API_BASE}/torrents/addMagnet`, `magnet=${encodeURIComponent(magnet)}`, {
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 8000
  });

  const torrentId = addRes.data?.id;
  if (!torrentId) throw new Error('Real-Debrid failed to add magnet');

  // 2. Fetch torrent info to inspect files
  const infoRes = await axios.get(`${API_BASE}/torrents/info/${torrentId}`, { headers, timeout: 8000 });
  const files = infoRes.data?.files || [];

  // Filter video files
  const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv'];
  const videoFiles = files
    .filter(f => videoExtensions.some(ext => f.path.toLowerCase().endsWith(ext)))
    .sort((a, b) => b.bytes - a.bytes); // Largest video first

  const chosenFileId = videoFiles[0]?.id || 'all';

  // 3. Select file
  await axios.post(`${API_BASE}/torrents/selectFiles/${torrentId}`, `files=${chosenFileId}`, {
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 8000
  });

  // 4. Get updated info for download links
  const updatedInfo = await axios.get(`${API_BASE}/torrents/info/${torrentId}`, { headers, timeout: 8000 });
  const links = updatedInfo.data?.links || [];

  if (links.length === 0) {
    throw new Error('Real-Debrid: Torrent is not yet downloaded or no links available');
  }

  // 5. Unrestrict first video link
  const unrestrictRes = await axios.post(`${API_BASE}/unrestrict/link`, `link=${encodeURIComponent(links[0])}`, {
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 8000
  });

  return unrestrictRes.data?.download || null;
}

module.exports = {
  id: 'realdebrid',
  name: 'Real-Debrid',
  checkCache,
  resolveStream
};
