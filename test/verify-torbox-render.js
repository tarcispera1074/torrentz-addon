const axios = require('axios');
const { encodeConfig } = require('../src/config');

async function verifyTorboxOnRender() {
  const config = {
    mode: 'xxx',
    providers: ['tpb', '1337x', 'limetorrents', 'rargb'],
    debridProvider: 'torbox',
    debridApiKey: 'fffb568d-e34d-4dda-829a-aefdafd07b0a',
    showP2PFallback: true,
    maxStreamsPerResolution: 5
  };

  const encoded = encodeConfig(config);
  const streamUrl = `https://torrentz-addon.onrender.com/${encoded}/stream/movie/torrentz:4629a1b5da71a3062b70c354c8f8b4d8e1840897.json`;

  console.log('--- Polling Render for TorBox Deployment ---');
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      console.log(`[Attempt ${attempt}] Querying Render stream endpoint...`);
      const res = await axios.get(streamUrl, { timeout: 10000 });
      const stream = res.data?.streams?.[0];

      if (stream && stream.name.includes('[TORBOX+]') && stream.url) {
        console.log('✅ Render returned TorBox stream:', stream);
        console.log('Testing video playback redirect from Render URL:', stream.url);

        const videoHead = await axios.get(stream.url, {
          headers: { Range: 'bytes=0-1024' },
          maxRedirects: 5,
          timeout: 10000
        });

        console.log('✅ Video Playback Status from Render:', videoHead.status);
        console.log('Content-Type:', videoHead.headers['content-type']);
        console.log('CDN Destination:', videoHead.request.res.responseUrl || videoHead.config.url);
        console.log('🎉 VERIFICATION CONFIRMED: TORBOX STREAMS AND PLAYS FROM RENDER!');
        return;
      } else {
        console.log('Waiting for Render deployment to complete...');
      }
    } catch (e) {
      console.log('Waiting for Render...', e.response ? e.response.status : e.message);
    }
    await new Promise(r => setTimeout(r, 6000));
  }
}

verifyTorboxOnRender();
