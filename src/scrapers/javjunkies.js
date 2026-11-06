const { makeJavScraperWithFallback } = require('./jav');
module.exports = makeJavScraperWithFallback('javjunkies', 'JAVJunkies', [
  q => `https://javjunkies.org/?s=${encodeURIComponent(q)}`,
  q => `https://javjunkies.org/search/${encodeURIComponent(q)}`
]);
