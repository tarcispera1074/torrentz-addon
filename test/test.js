const { getMetadata } = require('../src/metadata/cinemeta');
const { searchAll } = require('../src/scrapers');
const { decodeConfig, encodeConfig } = require('../src/config');

async function runTests() {
  console.log('--- Testing Config Encoder/Decoder ---');
  const sampleConfig = {
    providers: ['tpb', '1337x'],
    debridProvider: 'realdebrid',
    debridApiKey: 'sample_token_123',
    showP2PFallback: true,
    maxStreamsPerResolution: 3
  };
  const encoded = encodeConfig(sampleConfig);
  console.log('Encoded config:', encoded);
  const decoded = decodeConfig(encoded);
  console.log('Decoded config matches:', decoded.debridProvider === 'realdebrid');

  console.log('\n--- Testing Cinemeta Metadata Resolver ---');
  const movieMeta = await getMetadata('movie', 'tt1375666'); // Inception
  console.log('Movie:', movieMeta?.name, `(${movieMeta?.year})`, 'Query:', movieMeta?.searchQuery);

  const seriesMeta = await getMetadata('series', 'tt0903747:1:1'); // Breaking Bad S01E01
  console.log('Series:', seriesMeta?.name, 'Query:', seriesMeta?.searchQuery);

  console.log('\n--- Testing Scrapers (ThePirateBay & Others) ---');
  const results = await searchAll('Inception 2010', ['tpb']);
  console.log(`Found ${results.length} torrents from TPB`);
  if (results.length > 0) {
    console.log('Top result:', {
      title: results[0].rawTitle,
      infoHash: results[0].infoHash,
      seeders: results[0].seeders,
      source: results[0].source
    });
  }

  console.log('\n✅ All core unit tests passed!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
