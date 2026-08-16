import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TTLCache } from "./cache.js";
import { geocode } from "./geocode.js";

import {
  earthquakes,
  opensky,
  satellites
} from "./adapters.js";

import { getReplay } from "./replay.js";
import { propagate } from "./satellite.js";
import { correlate } from "./correlation.js";
import { put, get } from "./store.js";

const __dirname =
  path.dirname(
    fileURLToPath(import.meta.url)
  );

const app = express();

const port = Number(
  process.env.PORT || 10000
);

const cache =
  new TTLCache(30_000);

app.use(
  express.json({
    limit: "5mb"
  })
);

/*
|--------------------------------------------------------------------------
| HEALTH
|--------------------------------------------------------------------------
*/

app.get(
  "/api/health",
  (_req, res) => {
    res.json({
      ok: true,
      service: "worldview-godseye",
      phase: 5,
      time: new Date().toISOString()
    });
  }
);

/*
|--------------------------------------------------------------------------
| FRONTEND CONFIG
|--------------------------------------------------------------------------
*/

app.get(
  "/api/config",
  (_req, res) => {
    res.json({
      cesiumIonToken:
        process.env.CESIUM_ION_TOKEN || ""
    });
  }
);

/*
|--------------------------------------------------------------------------
| GEOCODING
|--------------------------------------------------------------------------
*/

app.get(
  "/api/geocode",
  async (req, res) => {
    try {
      const query =
        String(
          req.query.q || ""
        ).trim();

      if (!query) {
        return res.json([]);
      }

      const result =
        await geocode(query);

      res.json(result);
    } catch (error) {
      console.error(
        "Geocoding error:",
        error
      );

      res.status(502).json({
        error:
          error.message ||
          "Geocoding request failed"
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| GENERIC CACHED DATA ROUTE
|--------------------------------------------------------------------------
*/

async function dataRoute(
  key,
  fetcher,
  res,
  ttlMs = 30_000
) {
  try {
    let value =
      cache.get(key);

    if (!value) {
      value =
        await fetcher();

      cache.set(
        key,
        value,
        ttlMs
      );
    }

    res.json(value);
  } catch (error) {
    console.error(
      `Data route failed [${key}]:`,
      error
    );

    res.status(502).json({
      error:
        error.message ||
        "Upstream data request failed"
    });
  }
}

/*
|--------------------------------------------------------------------------
| EARTHQUAKES
|--------------------------------------------------------------------------
*/

app.get(
  "/api/data/earthquakes",
  (_req, res) =>
    dataRoute(
      "earthquakes",
      earthquakes,
      res,
      60_000
    )
);

/*
|--------------------------------------------------------------------------
| AIRCRAFT
|--------------------------------------------------------------------------
|
| OpenSky is rate-limited. We cache snapshots briefly.
|--------------------------------------------------------------------------
*/

app.get(
  "/api/data/flights",
  (_req, res) =>
    dataRoute(
      "flights",
      opensky,
      res,
      10_000
    )
);

/*
|--------------------------------------------------------------------------
| SATELLITE ORBITAL CATALOG
|--------------------------------------------------------------------------
|
| This is the raw orbital-element source used by satellite.js.
|--------------------------------------------------------------------------
*/

app.get(
  "/api/data/satellites",
  async (req, res) => {
    try {
      const group =
        String(
          req.query.group ||
          "visual"
        );

      const cacheKey =
        `satellites:${group}`;

      const value =
        await (async () => {
          let cached =
            cache.get(
              cacheKey
            );

          if (cached) {
            return cached;
          }

          const catalog =
            await satellites(
              group
            );

          cache.set(
            cacheKey,
            catalog,
            30 * 60 * 1000
          );

          return catalog;
        })();

      res.json(value);
    } catch (error) {
      console.error(
        "Satellite catalog error:",
        error
      );

      res.status(502).json({
        error:
          error.message ||
          "Satellite catalog request failed"
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| NORMALIZED SATELLITE CATALOG
|--------------------------------------------------------------------------
|
| Used by the frontend live-orbit renderer.
|
| It returns TLE/GP information rather than one static position.
| satellite.js then continuously propagates those elements in the browser.
|--------------------------------------------------------------------------
*/

app.get(
  "/api/data/satellite-catalog",
  async (req, res) => {
    try {
      const group =
        String(
          req.query.group ||
          "visual"
        );

      const cacheKey =
        `satellite-catalog:${group}`;

      let catalog =
        cache.get(
          cacheKey
        );

      if (!catalog) {
        catalog =
          await satellites(
            group
          );

        cache.set(
          cacheKey,
          catalog,
          30 * 60 * 1000
        );
      }

      const rows =
        (Array.isArray(catalog)
          ? catalog
          : []
        )
          .map((record) => {
            const name =
              record.OBJECT_NAME ||
              record.OBJECT_NAME_EN ||
              record.NAME ||
              record.name ||
              "Satellite";

            const norad =
              String(
                record.NORAD_CAT_ID ||
                record.NORAD_CAT_ID ||
                record.OBJECT_ID ||
                record.norad ||
                name
              );

            const tle1 =
              record.TLE_LINE1 ||
              record.LINE1 ||
              record.tle1 ||
              record.TLE1 ||
              "";

            const tle2 =
              record.TLE_LINE2 ||
              record.LINE2 ||
              record.tle2 ||
              record.TLE2 ||
              "";

            return {
              name,
              norad,
              TLE_LINE1: tle1,
              TLE_LINE2: tle2
            };
          })
          .filter(
            (record) =>
              record.TLE_LINE1 &&
              record.TLE_LINE2
          )
          .slice(
            0,
            1000
          );

      res.json({
        group,

        count:
          rows.length,

        fetchedAt:
          new Date().toISOString(),

        rows
      });
    } catch (error) {
      console.error(
        "Normalized satellite catalog error:",
        error
      );

      res.status(502).json({
        error:
          error.message ||
          "Satellite catalog normalization failed"
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SATELLITE POSITION SNAPSHOT
|--------------------------------------------------------------------------
|
| Keeps your original endpoint.
|
| Useful for debugging, APIs, and non-animated clients.
|--------------------------------------------------------------------------
*/

app.get(
  "/api/data/satellite-positions",
  async (req, res) => {
    try {
      const group =
        String(
          req.query.group ||
          "visual"
        );

      const timestamp =
        Number(
          req.query.at ||
          Date.now()
        );

      const cacheKey =
        `satellite-positions:${group}:${Math.floor(
          timestamp / 30_000
        )}`;

      let value =
        cache.get(
          cacheKey
        );

      if (!value) {
        let catalog =
          cache.get(
            `satellite-catalog:${group}`
          );

        if (!catalog) {
          catalog =
            await satellites(
              group
            );

          cache.set(
            `satellite-catalog:${group}`,
            catalog,
            30 * 60 * 1000
          );
        }

        const rows =
          (Array.isArray(catalog)
            ? catalog
            : []
          )
            .map(
              (record) => {
                try {
                  const position =
                    propagate(
                      record,
                      timestamp
                    );

                  if (
                    !position
                  ) {
                    return null;
                  }

                  return {
                    name:
                      record.OBJECT_NAME ||
                      record.OBJECT_NAME_EN ||
                      record.NAME ||
                      "Satellite",

                    norad:
                      record.NORAD_CAT_ID ||
                      record.OBJECT_ID ||
                      "",

                    ...position
                  };
                } catch {
                  return null;
                }
              }
            )
            .filter(Boolean);

        value = {
          time:
            new Date(
              timestamp
            ).toISOString(),

          group,

          rows
        };

        cache.set(
          cacheKey,
          value,
          30_000
        );
      }

      res.json(value);
    } catch (error) {
      console.error(
        "Satellite position error:",
        error
      );

      res.status(502).json({
        error:
          error.message ||
          "Satellite position calculation failed"
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| REPLAY SYSTEM
|--------------------------------------------------------------------------
*/

app.get(
  "/api/replay/:id",
  async (req, res) => {
    try {
      const replay =
        await getReplay(
          req.params.id
        );

      res.json(replay);
    } catch (error) {
      console.error(
        "Replay loading error:",
        error
      );

      res.status(404).json({
        error:
          error.message ||
          "Replay not found"
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| EVENT CORRELATION
|--------------------------------------------------------------------------
*/

app.post(
  "/api/correlate",
  (req, res) => {
    try {
      const events =
        Array.isArray(
          req.body?.events
        )
          ? req.body.events
          : [];

      const options =
        req.body?.options ||
        {};

      const result =
        correlate(
          events,
          options
        );

      res.json(result);
    } catch (error) {
      console.error(
        "Correlation error:",
        error
      );

      res.status(400).json({
        error:
          error.message ||
          "Correlation failed"
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| WORKSPACES
|--------------------------------------------------------------------------
*/

app.post(
  "/api/workspaces/:id",
  (req, res) => {
    try {
      const result =
        put(
          req.params.id,
          req.body || {}
        );

      res.json(result);
    } catch (error) {
      console.error(
        "Workspace save error:",
        error
      );

      res.status(400).json({
        error:
          error.message ||
          "Workspace save failed"
      });
    }
  }
);

app.get(
  "/api/workspaces/:id",
  (req, res) => {
    try {
      const value =
        get(
          req.params.id
        );

      if (!value) {
        return res.status(404).json({
          error:
            "Workspace not found"
        });
      }

      res.json(value);
    } catch (error) {
      console.error(
        "Workspace load error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Workspace load failed"
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SOURCE STATUS
|--------------------------------------------------------------------------
*/

app.get(
  "/api/status",
  (_req, res) => {
    res.json({
      server: {
        status: "ONLINE",
        time:
          new Date().toISOString()
      },

      streams: {
        earthquakes: {
          source: "USGS",
          kind: "live",
          endpoint:
            "/api/data/earthquakes"
        },

        flights: {
          source: "OpenSky",
          kind: "live/rate-limited",
          endpoint:
            "/api/data/flights"
        },

        satellites: {
          source: "CelesTrak",
          kind: "orbital-elements",
          endpoint:
            "/api/data/satellite-catalog"
        },

        satellitePositions: {
          source:
            "CelesTrak + satellite.js",
          kind:
            "propagated",
          endpoint:
            "/api/data/satellite-positions"
        },

        replay: {
          source: "WorldView Replay Engine",
          kind: "historical/synthetic depending on dataset",
          endpoint:
            "/api/replay/:id"
        }
      }
    });
  }
);

/*
|--------------------------------------------------------------------------
| FRONTEND STATIC FILES
|--------------------------------------------------------------------------
*/

const distPath =
  path.join(
    __dirname,
    "..",
    "dist"
  );

app.use(
  express.static(
    distPath,
    {
      index: false
    }
  )
);

/*
|--------------------------------------------------------------------------
| SPA FALLBACK
|--------------------------------------------------------------------------
|
| Express 5 syntax.
|--------------------------------------------------------------------------
*/

app.get(
  "/{*splat}",
  (_req, res) => {
    res.sendFile(
      path.join(
        distPath,
        "index.html"
      )
    );
  }
);

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

app.listen(
  port,
  "0.0.0.0",
  () => {
    console.log(
      `WorldView server listening on port ${port}`
    );
  }
);
