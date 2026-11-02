const axios = require('axios');

const API_BASE = 'https://api.torbox.app/v1/api';

/**
 * Check which infohashes are cached on TorBox
 */
async function checkCache(apiKey, infoHashes) {
  if (!apiKey || !infoHashes || infoHashes.length === 0) return new Set();

  const cachedHashes = new Set();
  try {
    const hashesParam = infoHashes.join(',');
    const url = `${API_BASE}/torrents/checkcached?hash=${hashesParam}&format=list`;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 6000
    });

    if (res.data?.success) {
      const data = res.data.data;
      if (Array.isArray(data)) {
        data.forEach(item => {
          if (typeof item === 'string') {
            cachedHashes.add(item.toLowerCase());
          } else if (item && item.hash) {
            // If item has cached property, verify it's true
            if (item.cached === undefined || item.cached === true) {
              cachedHashes.add(item.hash.toLowerCase());
            }
          }
        });
      } else if (typeof data === 'object' && data !== null) {
        for (const [h, val] of Object.entries(data)) {
          if (val === true || (val && val.cached !== false)) {
            cachedHashes.add(h.toLowerCase());
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[TorBox] Cache check error: ${err.message}`);
  }

  return cachedHashes;
}

/**
 * Resolve torrent hash to a direct streamable HTTP URL using TorBox
 */
async function resolveStream(apiKey, infoHash) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const cleanHash = infoHash.toLowerCase();

  let torrentId = null;
  let files = [];

  // 1. Add magnet to user's TorBox account
  try {
    const params = new URLSearchParams();
    params.append('magnet', `magnet:?xt=urn:btih:${cleanHash}`);
    params.append('seed', '1');
    params.append('allow_zip', 'false');

    const createRes = await axios.post(`${API_BASE}/torrents/createtorrent`, params.toString(), {
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 8000
    });

    torrentId = createRes.data?.data?.torrent_id;
  } catch (err) {
    // Might already exist in account or cached
    console.log('[TorBox] createtorrent info:', err.response?.data?.detail || err.message);
  }

  // 2. Query user's torrent list to get file structure and correct torrent ID
  try {
    const listRes = await axios.get(`${API_BASE}/torrents/mylist`, { headers, timeout: 8000 });
    const torrentList = Array.isArray(listRes.data?.data) ? listRes.data.data : [];

    const match = torrentList.find(t => 
      (torrentId && t.id == torrentId) || 
      (t.hash && t.hash.toLowerCase() === cleanHash)
    );

    if (match) {
      torrentId = match.id;
      files = match.files || [];
    }
  } catch (err) {
    console.warn('[TorBox] mylist fetch warning:', err.message);
  }

  if (!torrentId) {
    throw new Error('TorBox: Torrent could not be added or found in account');
  }

  // 3. Select the best/largest video file
  const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.webm', '.flv'];
  let chosenFile = null;

  if (files.length > 0) {
    const videoFiles = files
      .filter(f => videoExts.some(ext => (f.name || f.short_name || '').toLowerCase().endsWith(ext)))
      .sort((a, b) => (b.size || 0) - (a.size || 0));

    chosenFile = videoFiles[0] || files[0];
  }

  const fileId = chosenFile ? chosenFile.id : 0;

  // 4. Request download link
  try {
    const dlUrl = `${API_BASE}/torrents/requestdl?token=${encodeURIComponent(apiKey)}&torrent_id=${torrentId}&file_id=${fileId}&zip=false`;
    const dlRes = await axios.get(dlUrl, { headers, timeout: 8000 });

    if (dlRes.data?.data && typeof dlRes.data.data === 'string') {
      return dlRes.data.data;
    }
  } catch (err) {
    console.warn('[TorBox] requestdl error, using direct permalink:', err.message);
  }

  // Fallback to TorBox official permanent redirect link
  return `${API_BASE}/torrents/requestdl?token=${encodeURIComponent(apiKey)}&torrent_id=${torrentId}&file_id=${fileId}&redirect=true`;
}

module.exports = {
  id: 'torbox',
  name: 'TorBox',
  checkCache,
  resolveStream
};
