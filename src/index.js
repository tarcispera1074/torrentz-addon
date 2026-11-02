require('dotenv').config();
const app = require('./server');

const PORT = process.env.PORT || 7000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Torrentz Stremio Addon Server is Running!`);
  console.log(`📍 Web UI:      http://localhost:${PORT}/configure`);
  console.log(`📡 Manifest:    http://localhost:${PORT}/manifest.json`);
  console.log(`=======================================================`);
});
