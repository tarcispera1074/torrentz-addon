const { makeJavScraperWithFallback } = require('./jav');
module.exports = makeJavScraperWithFallback('avfan', 'AVFan', [
  q => `https://avfan.com/search/${encodeURIComponent(q)}`,
  q => `https://avfan.com/?s=${encodeURIComponent(q)}`
]);
