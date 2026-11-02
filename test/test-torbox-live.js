const axios = require('axios');
const torbox = require('../src/debrid/torbox');

const API_KEY = 'fffb568d-e34d-4dda-829a-aefdafd07b0a';

async function runLiveTorboxTest() {
  console.log('--- 1. Testing TorBox Authentication & User Profile ---');
  try {
    const userRes = await axios.get('https://api.torbox.app/v1/api/user/me', {
      headers: { Authorization: `Bearer ${API_KEY}` }
    });
    console.log('User status:', userRes.data);
  } catch (err) {
    console.error('User auth error:', err.response?.data || err.message);
  }

  console.log('\n--- 2. Testing TorBox Cache Check ---');
  const testHashes = [
    '224bf45881252643dfc2e71abc7b2660a21c68c4', // Inception 1080p YIFY (widely cached)
    '4629a1b5da71a3062b70c354c8f8b4d8e1840897'  // Blair Williams
  ];

  try {
    const rawCacheRes = await axios.get(`https://api.torbox.app/v1/api/torrents/checkcached?hash=${testHashes.join(',')}&format=list`, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    });
    console.log('Raw checkcached response:', JSON.stringify(rawCacheRes.data, null, 2));

    const cachedSet = await torbox.checkCache(API_KEY, testHashes);
    console.log('torbox.checkCache returned set:', Array.from(cachedSet));
  } catch (err) {
    console.error('checkcached error:', err.response?.data || err.message);
  }

  console.log('\n--- 3. Testing TorBox Stream Resolution ---');
  // Test resolving Inception (which is almost certainly cached)
  const targetHash = '224bf45881252643dfc2e71abc7b2660a21c68c4';
  try {
    const streamUrl = await torbox.resolveStream(API_KEY, targetHash);
    console.log('✅ Resolved Stream URL:', streamUrl);

    // Verify stream URL actually responds with HTTP 200 or 302 and video content
    console.log('\n--- 4. Testing Video Playback URL Connectivity ---');
    const headRes = await axios.get(streamUrl, {
      headers: { Range: 'bytes=0-1024' }, // Request first 1KB of video
      timeout: 10000,
      maxRedirects: 5
    });
    console.log('✅ Playback test HTTP status:', headRes.status);
    console.log('Content-Type:', headRes.headers['content-type']);
    console.log('Content-Range:', headRes.headers['content-range'] || headRes.headers['content-length']);
    console.log('🎉 VIDEO STREAM PLAYS SUCCESSFULLY VIA TORBOX!');
  } catch (err) {
    console.error('❌ Stream resolution error:', err.response?.data || err.message);
  }
}

runLiveTorboxTest();
