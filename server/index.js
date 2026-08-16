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
| TEMPORARY OPENSKY DIAGNOSTIC
|--------------------------------------------------------------------------
|
| This endpoint checks:
| 1. Whether Render has the client ID
| 2. Whether Render has the client secret
| 3. Whether Render can reach the OpenSky OAuth server
| 4. What HTTP status OpenSky returns
|
| It NEVER returns the actual client secret or access token.
|--------------------------------------------------------------------------
*/

app.get(
  "/api/debug/opensky",
  async (_req, res) => {
    const result = {
      hasClientId:
        Boolean(
          process.env.OPENSKY_CLIENT_ID
        ),

      hasClientSecret:
        Boolean(
          process.env.OPENSKY_CLIENT_SECRET
        ),

      authReachable: false,

      authStatus: null,

      authResponsePreview: null,

      authError: null
    };

    try {
      /*
       * Protect against a missing environment variable.
       */
      if (
        !process.env.OPENSKY_CLIENT_ID ||
        !process.env.OPENSKY_CLIENT_SECRET
      ) {
        result.authError =
          "OpenSky environment variables are missing";

        return res.json(result);
      }

      /*
       * OpenSky OAuth2 client-credentials request.
       */
      const body =
        new URLSearchParams({
          grant_type:
            "client_credentials",

          client_id:
            process.env.OPENSKY_CLIENT_ID,

          client_secret:
            process.env.OPENSKY_CLIENT_SECRET
        });

      const response =
        await fetch(
          "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded",

              Accept:
                "application/json"
            },

            body:
              body.toString(),

            signal:
              AbortSignal.timeout(
                15_000
              )
          }
        );

      result.authReachable =
        true;

      result.authStatus =
        response.status;

      const text =
        await response.text();

      /*
       * NEVER return an actual OAuth access token.
       *
       * Only return a small diagnostic preview.
       */
      try {
        const parsed =
          JSON.parse(text);

        result.authResponsePreview =
          {
            tokenReceived:
              Boolean(
                parsed.access_token
              ),

            expiresIn:
              parsed.expires_in ??
              null,

            tokenType:
              parsed.token_type ??
              null,

            error:
              parsed.error ??
              null,

            errorDescription:
              parsed.error_description ??
              null
          };
      } catch {
        result.authResponsePreview =
          text.slice(
            0,
            300
          );
      }
    } catch (error) {
      result.authError =
        error?.message ||
        String(error);
    }

    res.json(result);
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
| SATELLITE CATALOG
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

      let value =
        cache.get(
          cacheKey
        );

      if (!value) {
        value =
          await satellites(
            group
          );

        cache.set(
          cacheKey,
          value,
          30 * 60 * 1000
        );
      }

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
        (
          Array.isArray(
            catalog
          )
            ? catalog
            : []
        )
          .map(
            (record) => {
              const name =
                record.OBJECT_NAME ||
                record.OBJECT_NAME_EN ||
                record.NAME ||
                record.name ||
                "Satellite";

              const norad =
                String(
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
            }
          )
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
        (
          Array.isArray(
            catalog
          )
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

                if (!position) {
                  return null;
                }

                return {
                  name:
                    record.OBJECT_NAME ||
                    record.OBJECT_NAME_EN ||
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

      res.json({
        time:
          new Date(
            timestamp
          ).toISOString(),

        group,

        rows
      });
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
| REPLAY
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
          source:
            "WorldView Replay Engine",
          kind:
            "historical/synthetic depending on dataset",
          endpoint:
            "/api/replay/:id"
        }
      }
    });
  }
);

/*
|--------------------------------------------------------------------------
| STATIC FRONTEND
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
