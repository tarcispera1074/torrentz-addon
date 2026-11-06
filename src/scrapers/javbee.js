const { makeJavScraperWithFallback } = require('./jav');
module.exports = makeJavScraperWithFallback('javbee', 'JAVBEE', [
  q => `https://javbee.org/search/${encodeURIComponent(q)}`,
  q => `https://javbee.org/?s=${encodeURIComponent(q)}`
]);
