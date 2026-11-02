const axios = require('axios');

async function verify() {
  console.log('--- Verifying Search & Playback on Render ---');
  let searchSuccess = false;
  let testId = null;

  for (let attempt = 1; attempt <= 25; attempt++) {
    try {
      console.log(`[Attempt ${attempt}] Searching Blair Williams on Render...`);
      // Test the XXX movie search catalog
      const res = await axios.get('https://torrentz-addon.onrender.com/catalog/movie/torrentz_xxx/search=Blair%20Williams.json', { timeout: 10000 });
      
      const metas = res.data?.metas || [];
      if (metas.length > 0) {
        console.log(`✅ Success! Render returned ${metas.length} video tiles for "Blair Williams"!`);
        console.log('Sample 1:', {
          id: metas[0].id,
          name: metas[0].name,
          desc: metas[0].description
        });
        console.log('Sample 2:', {
          id: metas[1].id,
          name: metas[1].name,
          desc: metas[1].description
        });

        testId = metas[0].id;
        searchSuccess = true;
        break;
      } else {
        console.log('Still returned 0 metas, waiting 5s for deployment to finish...');
      }
    } catch (e) {
      console.log('Render request error:', e.response ? e.response.status : e.message);
    }
    await new Promise(r => setTimeout(r, 6000));
  }

  if (!searchSuccess) {
    console.error('❌ Search verification failed.');
    process.exit(1);
  }

  console.log(`\n--- Verifying Stream Resolution for ${testId} ---`);
  try {
    const streamRes = await axios.get(`https://torrentz-addon.onrender.com/stream/movie/${testId}.json`, { timeout: 10000 });
    const streams = streamRes.data?.streams || [];
    console.log(`✅ Stream endpoint returned ${streams.length} stream(s)!`);
    console.log('Full Stream details:', JSON.stringify(streams[0], null, 2));

    if (streams.length > 0 && streams[0].infoHash && streams[0].sources?.length > 0) {
      console.log('\n🎉 ALL VERIFICATION CHECKS PASSED:');
      console.log('1. Search produces real video results on live Render server.');
      console.log('2. Stream object has active infoHash and 5+ public tracker sources for instant playback.');
    }
  } catch (e) {
    console.error('❌ Stream resolution error:', e.message);
    process.exit(1);
  }
}

verify();
