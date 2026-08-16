# Phase 2 — Live data streams

Adds normalized live data adapters for USGS earthquakes, OpenSky aircraft and CelesTrak satellites, plus source-status UI and a data refresh loop.

The browser receives normalized objects from the backend instead of calling feeds directly.

OpenSky access should use OAuth2 for programmatic use; anonymous access is rate-limited. CelesTrak GP data is available as JSON and other formats. USGS provides GeoJSON feeds.
