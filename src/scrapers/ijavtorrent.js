const { makeJavScraperWithFallback } = require('./jav');
module.exports = makeJavScraperWithFallback('ijavtorrent', 'iJavTorrent', [
  q => `https://ijavtorrent.com/search/${encodeURIComponent(q)}`,
  q => `https://ijavtorrent.com/?s=${encodeURIComponent(q)}`
]);
