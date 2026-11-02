const axios = require('axios');

async function poll() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await axios.get('https://torrentz-addon.onrender.com/test-raw-tpb', { timeout: 10000 });
      console.log('✅ Render updated! Status:', res.status);
      console.log('Response summary:', {
        status: res.data.status,
        length: res.data.length,
        isArray: res.data.isArray,
        sample: res.data.sample,
        raw: Array.isArray(res.data.raw) ? res.data.raw.slice(0, 2) : res.data.raw
      });
      return;
    } catch (e) {
      console.log(`[Attempt ${i + 1}] Waiting for Render... (${e.response ? e.response.status : e.message})`);
      await new Promise(r => setTimeout(r, 6000));
    }
  }
}

poll();
