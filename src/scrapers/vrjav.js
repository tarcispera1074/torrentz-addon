const { makeJavScraperWithFallback } = require('./jav');
module.exports = makeJavScraperWithFallback('vrjav', 'VRJAV', [
  q => `https://vrjav.net/search/${encodeURIComponent(q)}`,
  q => `https://vrjav.net/?s=${encodeURIComponent(q)}`
]);
