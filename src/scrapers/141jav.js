const { makeJavScraper } = require('./jav');
module.exports = makeJavScraper('141jav', '141JAV', q => `https://www.141jav.com/search/${encodeURIComponent(q)}`);
