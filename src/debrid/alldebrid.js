const axios = require('axios');

const API_BASE = 'https://api.alldebrid.com/v4';
const AGENT = 'stremio-addon';

async function checkCache(apiKey, infoHashes) {
  if (!apiKey || !infoHashes || infoHashes.length === 0) return new Set();

  const cachedHashes = new Set();
  const chunkSize = 40;

  for (let i = 0; i < infoHashes.length; i += chunkSize) {
    const chunk = infoHashes.slice(i, i + chunkSize);
    try {
      const params = new URLSearchParams();
      params.append('agent', AGENT);
      params.append('apikey', apiKey);
      chunk.forEach(h => params.append('magnets[]', h));

      const res = await axios.get(`${API_BASE}/magnet/instant?${params.toString()}`, { timeout: 5000 });
      if (res.data?.status === 'success' && Array.isArray(res.data?.data?.magnets)) {
        for (const item of res.data.data.magnets) {
          if (item.instant && item.hash) {
            cachedHashes.add(item.hash.toLowerCase());
          }
        }
      }
    } catch (err) {
      console.warn(`[AllDebrid] Cache check error: ${err.message}`);
    }
  }

  return cachedHashes;
}

async function resolveStream(apiKey, infoHash) {
  const magnet = `magnet:?xt=urn:btih:${infoHash}`;
  
  // 1. Upload magnet
  const uploadRes = await axios.get(`${API_BASE}/magnet/upload?agent=${AGENT}&apikey=${apiKey}&magnet=${encodeURIComponent(magnet)}`, { timeout: 8000 });
  const magnetData = uploadRes.data?.data?.magnets?.[0];
  const magnetId = magnetData?.id;

  if (!magnetId) throw new Error('AllDebrid: Failed to upload magnet');

  // 2. Check status & links
  const statusRes = await axios.get(`${API_BASE}/magnet/status?agent=${AGENT}&apikey=${apiKey}&id=${magnetId}`, { timeout: 8000 });
  const links = statusRes.data?.data?.magnets?.links || [];

  if (links.length === 0) {
    throw new Error('AllDebrid: Torrent not ready or no files found');
  }

  // 3. Unlock first link
  const linkToUnlock = links[0]?.link || links[0];
  const unlockRes = await axios.get(`${API_BASE}/link/unlock?agent=${AGENT}&apikey=${apiKey}&link=${encodeURIComponent(linkToUnlock)}`, { timeout: 8000 });

  return unlockRes.data?.data?.link || null;
}

module.exports = {
  id: 'alldebrid',
  name: 'AllDebrid',
  checkCache,
  resolveStream
};
