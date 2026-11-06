const { makeJavScraper } = require('./jav');
module.exports = makeJavScraper('javbee', 'JAVBEE', q => `https://javbee.org/search/${encodeURIComponent(q)}`);
