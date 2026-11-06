const { makeJavScraperWithFallback, searchHomepage } = require('./jav');
const homepage = searchHomepage.bind(null, '141JAV', 'https://www.141jav.com/');
module.exports = makeJavScraperWithFallback('141jav', '141JAV', [
  q => homepage(q),
  q => `https://www.141jav.com/search/${encodeURIComponent(q)}`,
  q => `https://www.141jav.com/?s=${encodeURIComponent(q)}`
]);
