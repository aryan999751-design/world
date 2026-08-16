# WorldView Phase 1 — 3D Foundation

A self-contained immersive 3D Earth foundation: Cesium/WebGL globe, atmosphere, camera navigation, search, layer shell and production Render server.

This is an original implementation inspired by the interaction model shown in the WorldView / God's Eye View video. It does not copy source code from the reference repository.

## Phase
1 / 5

## Deploy to Render

- Type: **Web Service**
- Build: `npm install && npm run build`
- Start: `npm start`
- Health: `/api/health`
- Recommended: add `CESIUM_ION_TOKEN` for high-quality global terrain/imagery.

Secrets for OpenSky/AIS stay server-side.

## Important data note

Public feeds have real limits. OpenSky now recommends OAuth2 for programmatic access and applies per-endpoint credits/rate limits. CelesTrak provides GP data in JSON/CSV/TLE/other formats. USGS provides GeoJSON earthquake feeds. The app therefore caches and normalizes feeds instead of directly flooding external APIs.

## Project structure

```text
src/
  cesium/        globe, layers, camera
  components/    command-center UI
  data/          client data access
  playback/      4D timeline + event clock
  state/         app state
server/
  adapters/      external feeds
  cache/         TTL cache
  replay/        scenario/replay data
  routes/        API endpoints
```
