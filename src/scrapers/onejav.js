const { makeJavScraperWithFallback } = require('./jav');
module.exports = makeJavScraperWithFallback('onejav', 'OneJAV', [
  q => `https://onejav.com/search/${encodeURIComponent(q)}`,
  q => `https://onejav.com/?s=${encodeURIComponent(q)}`
]);
