# Sandbox-Hackathon

Local Chrome extension + MongoDB-backed cache for Terms/Privacy summaries.

## What was added

- A local cache API (`server/index.js`) backed by MongoDB.
- Extension caching flow in `background.js`:
  - checks cache by URL + content hash first,
  - reuses cached summary when unchanged,
  - regenerates and stores a new summary when policy text changes.
- Content script updates to send page URL + `document.lastModified`.
- Docker setup for local MongoDB and cache API.
- Popup settings for configurable cache API base URL.
- Popup History tab to browse/search cached policy summaries.

## Run locally with Docker

1. Start MongoDB + cache API:

```bash
docker compose up --build
```

2. Confirm API is up:

```bash
curl http://localhost:8787/health
```

3. Reload the Chrome extension in `chrome://extensions`.

## Data stored per policy URL

- `urlNormalized`
- `contentHash` (SHA-256 of extracted policy text)
- `policyUpdatedAt` (set when hash changes)
- `generatedAt`
- `summary` (the JSON summary from Gemini)

## API endpoints

- `POST /api/policies/lookup` with `{ "url": "...", "contentHash": "..." }`
- `POST /api/policies/upsert` with `{ "url": "...", "contentHash": "...", "summary": {...}, "sourceLastModified": "..." }`
- `GET /api/policies/history?limit=40&query=example.com`
- `GET /health`
