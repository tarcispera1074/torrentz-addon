const { makeJavScraper } = require('./jav');
module.exports = makeJavScraper('javjunkies', 'JAVJunkies', q => `https://javjunkies.org/?s=${encodeURIComponent(q)}`);
