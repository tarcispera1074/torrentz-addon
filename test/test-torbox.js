const axios = require('axios');

async function testTorboxCache() {
  const hash = '4629a1b5da71a3062b70c354c8f8b4d8e1840897'; // Blair Williams
  const hash2 = '224bf45881252643dfc2e71abc7b2660a21c68c4'; // Inception

  // Test comma vs multiple query params
  console.log('Testing Torbox checkcached endpoints...');
  try {
    const r1 = await axios.get(`https://api.torbox.app/v1/api/torrents/checkcached?hash=${hash}&hash=${hash2}&format=list`);
    console.log('Multiple params response:', r1.data);
  } catch (e) {
    console.log('Multiple params error:', e.response?.data || e.message);
  }

  try {
    const r2 = await axios.get(`https://api.torbox.app/v1/api/torrents/checkcached?hash=${hash},${hash2}&format=list`);
    console.log('Comma separated response:', r2.data);
  } catch (e) {
    console.log('Comma separated error:', e.response?.data || e.message);
  }

  // Also test POST with { hashes: [...] }
  try {
    const r3 = await axios.post(`https://api.torbox.app/v1/api/torrents/checkcached`, {
      hashes: [hash, hash2]
    });
    console.log('POST response:', r3.data);
  } catch (e) {
    console.log('POST error:', e.response?.data || e.message);
  }
}

testTorboxCache();
