const { makeJavScraperWithFallback, searchHomepage } = require('./jav');
const homepage = searchHomepage.bind(null, 'FFJAV', 'https://ffjav.com/');
module.exports = makeJavScraperWithFallback('ffjav', 'FFJAV', [
  q => homepage(q),
  q => `https://ffjav.com/search/${encodeURIComponent(q)}`,
  q => `https://ffjav.com/?s=${encodeURIComponent(q)}`
]);
