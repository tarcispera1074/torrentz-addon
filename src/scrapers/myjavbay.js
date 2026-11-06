const { makeJavScraperWithFallback } = require('./jav');
module.exports = makeJavScraperWithFallback('myjavbay', 'My JAV Bay', [
  q => `https://myjavbay.com/search/${encodeURIComponent(q)}`,
  q => `https://myjavbay.com/?s=${encodeURIComponent(q)}`
]);
