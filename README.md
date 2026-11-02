# ⚡ Torrentz — Stremio Torrent & Debrid Addon

A high-performance Stremio addon inspired by **Torrentio**, featuring direct built-in scrapers for top torrent indexers, instant Debrid cache resolution, and an interactive web configuration dashboard.

---

## 🚀 Supported Providers

### Torrent Indexers (Direct Built-in Scrapers)
- **ThePirateBay** (`thepiratebay.org` / Apibay JSON API + mirror backup)
- **1337x** (`1337x.to` with automatic mirror rotation)
- **LimeTorrents** (`limetorrents.fun` with domain failovers)
- **RARBG Mirrors** (`rargb.to` / mirror fallback)

### Debrid Providers (Cached Stream Resolvers)
- **Real-Debrid**
- **AllDebrid**
- **Premiumize**
- **TorBox**
- **Debrid-Link**
- *(Optional fallback to pure P2P torrent streaming if uncached)*

---

## 📁 Project Structure

```
Torrentz/
├── package.json              # Project dependencies & npm scripts
├── Dockerfile                # Production Docker container
├── docker-compose.yml        # Docker compose configuration
├── .env.example              # Environment variables template
├── test/
│   ├── test.js               # Unit test for metadata, parsing, and TPB
│   └── test-server.js        # Full server integration test
└── src/
    ├── index.js              # Server entry point
    ├── server.js             # Express routes (manifest, stream, playback, UI)
    ├── config.js             # Configuration encoder/decoder
    ├── metadata/
    │   └── cinemeta.js       # Cinemeta IMDb ID -> Title & Season/Episode resolver
    ├── scrapers/
    │   ├── index.js          # Scraper orchestrator (parallel search & deduplication)
    │   ├── tpb.js            # ThePirateBay scraper
    │   ├── 1337x.js          # 1337x scraper with mirror rotation
    │   ├── limetorrents.js   # LimeTorrents scraper
    │   └── rargb.js          # RARBG mirrors scraper
    ├── debrid/
    │   ├── index.js          # Debrid orchestrator
    │   ├── realdebrid.js     # Real-Debrid API integration
    │   ├── alldebrid.js      # AllDebrid API integration
    │   ├── premiumize.js     # Premiumize API integration
    │   ├── torbox.js         # TorBox API integration
    │   └── debridlink.js     # Debrid-Link API integration
    ├── utils/
    │   ├── parser.js         # Title parsing, size formatting & stream badges
    │   ├── cache.js          # In-memory TTL cache
    │   └── http.js           # Axios instance with desktop User-Agents
    └── views/
        └── configure.html    # Torrentio-style responsive dark mode web UI
```

---

## 🛠️ Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Addon
```bash
# Start server
npm start

# Or start in development mode with auto-reload
npm run dev
```

The server will start on port `7000`:
- **Web Configuration Dashboard**: `http://localhost:7000/configure`
- **Default Addon Manifest**: `http://localhost:7000/manifest.json`

---

## 📱 How to Install into Stremio

1. Open your browser and go to `http://localhost:7000/configure` (or your hosted domain).
2. Customize your settings:
   - Select which indexers to enable (1337x, TPB, LimeTorrents, RARBG).
   - Select your **Debrid Provider** (Real-Debrid, AllDebrid, TorBox, etc.) and paste your **API Key**.
   - Choose your stream resolution limits.
3. Click **"Install Addon to Stremio"** (opens Stremio directly via `stremio://` protocol).
   - *Alternatively, click **"Copy Manifest URL"**, open Stremio, go to **Addons**, paste the URL into the search bar, and click **Install**.*

---

## 🐳 Docker Deployment

To run in the background with Docker:
```bash
docker-compose up -d --build
```
Your addon is now accessible on port `7000`.

---

## 🧪 Testing

Run the automated test suite to check metadata resolution and scrapers:
```bash
npm test
```
Or test the full HTTP server and streaming endpoints:
```bash
node test/test-server.js
```
