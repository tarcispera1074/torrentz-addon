const { makeJavScraperWithFallback } = require('./jav');
module.exports = makeJavScraperWithFallback('projectjav', 'Project JAV', [
  q => `https://projectjav.com/search/${encodeURIComponent(q)}`,
  q => `https://projectjav.com/?s=${encodeURIComponent(q)}`
]);
