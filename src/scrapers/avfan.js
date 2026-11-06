const { makeJavScraper } = require('./jav');
module.exports = makeJavScraper('avfan', 'AVFan', q => `https://avfan.com/search/${encodeURIComponent(q)}`);
