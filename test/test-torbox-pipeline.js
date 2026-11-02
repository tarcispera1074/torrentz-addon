const app = require('../src/server');
const http = require('http');
const axios = require('axios');
const { encodeConfig } = require('../src/config');

async function testFullPipeline() {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(7774, resolve));

  const config = {
    mode: 'xxx',
    providers: ['tpb', '1337x', 'limetorrents', 'rargb'],
    debridProvider: 'torbox',
    debridApiKey: 'fffb568d-e34d-4dda-829a-aefdafd07b0a',
    showP2PFallback: true,
    maxStreamsPerResolution: 5
  };

  const encoded = encodeConfig(config);
  console.log('Encoded Config:', encoded);

  try {
    console.log('\n--- 1. Testing Stream Resolution for Blair Williams ---');
    // Hash for Blair Williams
    const id = 'torrentz:4629a1b5da71a3062b70c354c8f8b4d8e1840897';
    const streamRes = await axios.get(`http://localhost:7774/${encoded}/stream/movie/${id}.json`);
    
    console.log('Streams received count:', streamRes.data.streams.length);
    const stream = streamRes.data.streams[0];
    console.log('Stream 1:', stream);

    if (stream && stream.url) {
      console.log('\n--- 2. Testing Playback Redirect Endpoint ---');
      console.log('Accessing:', stream.url);
      
      const playbackRes = await axios.get(stream.url, {
        headers: { Range: 'bytes=0-1024' },
        maxRedirects: 5,
        timeout: 10000
      });

      console.log('✅ Final Playback HTTP Status:', playbackRes.status);
      console.log('Final Destination URL:', playbackRes.request.res.responseUrl || playbackRes.config.url);
      console.log('Content-Type:', playbackRes.headers['content-type']);
      console.log('\n🎉 FULL END-TO-END TORBOX PLAYBACK TEST PASSED!');
    }
  } catch (err) {
    console.error('Pipeline test error:', err.response ? err.response.data : err.message);
  } finally {
    server.close();
  }
}

testFullPipeline();
