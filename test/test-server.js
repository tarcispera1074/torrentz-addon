const app = require('../src/server');
const http = require('http');
const axios = require('axios');

async function testServer() {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(7777, resolve));

  try {
    console.log('Testing /manifest.json...');
    const manifestRes = await axios.get('http://localhost:7777/manifest.json');
    console.log('Manifest name:', manifestRes.data.name);

    console.log('Testing /stream/movie/tt1375666.json...');
    const streamRes = await axios.get('http://localhost:7777/stream/movie/tt1375666.json');
    console.log(`Received ${streamRes.data.streams.length} streams for Inception`);
    if (streamRes.data.streams.length > 0) {
      console.log('Sample Stream 1:', streamRes.data.streams[0]);
    }

    console.log('\n✅ Server integration test passed successfully!');
  } finally {
    server.close();
  }
}

testServer().catch(err => {
  console.error('Server test error:', err);
  process.exit(1);
});
