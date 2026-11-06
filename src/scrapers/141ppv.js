const { makeJavScraperWithFallback } = require('./jav');
module.exports = makeJavScraperWithFallback('141ppv', '141PPV', [
  q => `https://141ppv.com/search/${encodeURIComponent(q)}`,
  q => `https://141ppv.com/?s=${encodeURIComponent(q)}`
]);
