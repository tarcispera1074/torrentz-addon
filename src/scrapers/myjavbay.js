const { makeJavScraper } = require('./jav');
module.exports = makeJavScraper('myjavbay', 'My JAV Bay', q => `https://myjavbay.com/search/${encodeURIComponent(q)}`);
