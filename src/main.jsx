import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Cesium from "cesium";

import "cesium/Build/Cesium/Widgets/widgets.css";

import { config, earthquakes, flights, geocode } from "./data/api";
import { addEarthquakes, addFlights, clear } from "./cesium/World";
import { addSatelliteRows } from "./cesium/Satellites";

import Timeline from "./components/Timeline";
import Inspector from "./components/Inspector";
import SourceStatus from "./components/SourceStatus";

import "./styles.css";

const MIN = Date.parse("2026-08-16T08:00:00Z");
const MAX = Date.parse("2026-08-16T14:00:00Z");

function App() {
  const el = useRef(null);
  const vref = useRef(null);

  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);

  const [q, setQ] = useState("");

  const [eq, setEq] = useState();
  const [air, setAir] = useState();
  const [sat, setSat] = useState();

  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);

  const [mode, setMode] = useState("replay");

  const [time, setTime] = useState(MIN);
  const [play, setPlay] = useState(false);
  const [speed, setSpeed] = useState(15);

  const [layers, setLayers] = useState({
    eq: true,
    air: false,
    sat: true,
    replay: true
  });

  const [sources, setSources] = useState({
    USGS: "LOADING",
    OpenSky: "STANDBY",
    CelesTrak: "LOADING"
  });

  /*
   * Load configuration and initial data.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const cfg = await config();

        if (!cancelled) {
          setToken(cfg?.cesiumIonToken || "");
        }
      } catch (error) {
        console.error("Failed to load WorldView configuration:", error);

        if (!cancelled) {
          setToken("");
        }
      }

      try {
        const data = await earthquakes();

        if (!cancelled) {
          setEq(data);

          setSources((current) => ({
            ...current,
            USGS: "ONLINE"
          }));
        }
      } catch (error) {
        console.error("USGS earthquake feed failed:", error);

        if (!cancelled) {
          setSources((current) => ({
            ...current,
            USGS: "ERROR"
          }));
        }
      }

      try {
        const replayResponse = await fetch("/api/replay/demo");

        if (replayResponse.ok) {
          const replayData = await replayResponse.json();

          if (!cancelled) {
            setEvents(replayData?.events || []);
          }
        }
      } catch (error) {
        console.warn("Replay data unavailable:", error);
      }
    }

    loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Load aircraft only when enabled.
   */
  useEffect(() => {
    if (!layers.air) return;

    let cancelled = false;

    flights()
      .then((data) => {
        if (cancelled) return;

        setAir(data);

        setSources((current) => ({
          ...current,
          OpenSky: "ONLINE"
        }));
      })
      .catch((error) => {
        console.warn("OpenSky aircraft feed unavailable:", error);

        if (!cancelled) {
          setSources((current) => ({
            ...current,
            OpenSky: "RATE LIMITED"
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [layers.air]);

  /*
   * Load satellite positions only when enabled.
   */
  useEffect(() => {
    if (!layers.sat) return;

    let cancelled = false;

    fetch("/api/data/satellite-positions?group=visual")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Satellite request failed: ${response.status}`);
        }

        return response.json();
      })
      .then((data) => {
        if (cancelled) return;

        setSat(data);

        setSources((current) => ({
          ...current,
          CelesTrak: "ONLINE"
        }));
      })
      .catch((error) => {
        console.warn("CelesTrak satellite feed unavailable:", error);

        if (!cancelled) {
          setSources((current) => ({
            ...current,
            CelesTrak: "ERROR"
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [layers.sat]);

  /*
   * Cesium viewer lifecycle.
   *
   * IMPORTANT:
   * The old implementation could destroy a viewer while another React
   * effect was still trying to access it. This version carefully guards
   * creation, destruction, and Ion failures.
   */
  useEffect(() => {
    let viewer = null;
    let cancelled = false;

    async function bootCesium() {
      try {
        setReady(false);

        if (!el.current) {
          return;
        }

        /*
         * Configure Cesium Ion when a token exists.
         */
        if (token) {
          Cesium.Ion.defaultAccessToken = token;
        }

        /*
         * Safe fallback terrain.
         */
        let terrainProvider = new Cesium.EllipsoidTerrainProvider();

        /*
         * Safe fallback imagery.
         */
        let imageryProvider = null;

        /*
         * Try Cesium Ion terrain.
         *
         * If it fails, DO NOT kill the entire application.
         */
        if (token) {
          try {
            terrainProvider =
              await Cesium.CesiumTerrainProvider.fromIonAssetId(1);

            console.info("Cesium Ion terrain loaded.");
          } catch (error) {
            console.warn(
              "Cesium Ion terrain unavailable. Using ellipsoid fallback.",
              error
            );

            terrainProvider =
              new Cesium.EllipsoidTerrainProvider();
          }
        }

        /*
         * Try Cesium Ion imagery.
         *
         * Again, failure should not destroy the globe.
         */
        if (token) {
          try {
            imageryProvider =
              await Cesium.IonImageryProvider.fromAssetId(2);

            console.info("Cesium Ion imagery loaded.");
          } catch (error) {
            console.warn(
              "Cesium Ion imagery unavailable. Using globe fallback.",
              error
            );

            imageryProvider = null;
          }
        }

        /*
         * React may have unmounted while the async Ion requests were
         * completing.
         */
        if (cancelled || !el.current) {
          return;
        }

        /*
         * Create the actual viewer only after terrain/imagery resolution.
         */
        viewer = new Cesium.Viewer(el.current, {
          animation: false,

          baseLayer: imageryProvider || undefined,
          baseLayerPicker: false,

          geocoder: false,
          homeButton: false,
          sceneModePicker: false,

          timeline: false,
          infoBox: false,
          selectionIndicator: false,

          terrainProvider,

          shouldAnimate: true
        });

        /*
         * Visual settings.
         */
        viewer.scene.globe.enableLighting = true;
        viewer.scene.skyAtmosphere.show = true;
        viewer.scene.fog.enabled = true;
        viewer.scene.postProcessStages.fxaa.enabled = true;

        /*
         * Initial camera position.
         */
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            44,
            28,
            16_500_000
          ),
          duration: 2
        });

        /*
         * Globe click handler.
         */
        viewer.screenSpaceEventHandler.setInputAction(
          (click) => {
            if (!viewer || viewer.isDestroyed()) {
              return;
            }

            try {
              const picked = viewer.scene.pick(click.position);

              if (!picked || !picked.id) {
                return;
              }

              const properties = picked.id.properties;

              if (!properties) {
                return;
              }

              const object = {};

              for (const propertyName of properties.propertyNames) {
                object[propertyName] =
                  properties.getValue(viewer.clock.currentTime);
              }

              setSelected(object);
            } catch (error) {
              console.warn("Object selection failed:", error);
            }
          },
          Cesium.ScreenSpaceEventType.LEFT_CLICK
        );

        /*
         * Store only a valid viewer.
         */
        if (!cancelled && !viewer.isDestroyed()) {
          vref.current = viewer;
          setReady(true);
        }
      } catch (error) {
        console.error(
          "WorldView Cesium initialization failed:",
          error
        );

        /*
         * Never leave a broken viewer reference behind.
         */
        vref.current = null;

        if (viewer && !viewer.isDestroyed()) {
          try {
            viewer.destroy();
          } catch (destroyError) {
            console.warn(
              "Failed to destroy broken Cesium viewer:",
              destroyError
            );
          }
        }

        viewer = null;

        if (!cancelled) {
          setReady(false);
        }
      }
    }

    bootCesium();

    /*
     * Cleanup.
     */
    return () => {
      cancelled = true;

      setReady(false);

      /*
       * Clear the ref BEFORE destroying the viewer so another React
       * effect cannot accidentally use a stale viewer.
       */
      const currentViewer = vref.current;

      vref.current = null;

      if (currentViewer && !currentViewer.isDestroyed()) {
        try {
          currentViewer.destroy();
        } catch (error) {
          console.warn("Cesium cleanup error:", error);
        }
      }

      viewer = null;
    };
  }, [token]);

  /*
   * 4D playback clock.
   */
  useEffect(() => {
    if (!play || mode !== "replay") {
      return;
    }

    const timer = setInterval(() => {
      setTime((currentTime) => {
        const nextTime = currentTime + 1000 * speed;

        if (nextTime >= MAX) {
          return MIN;
        }

        return nextTime;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [play, speed, mode]);

  /*
   * Render layers into the currently active Cesium viewer.
   *
   * IMPORTANT:
   * This verifies that the viewer still exists before accessing entities.
   */
  useEffect(() => {
    const viewer = vref.current;

    if (!viewer) {
      return;
    }

    if (!ready) {
      return;
    }

    if (viewer.isDestroyed()) {
      return;
    }

    try {
      clear(viewer);

      /*
       * LIVE MODE
       */
      if (mode === "live") {
        if (layers.eq) {
          addEarthquakes(viewer, eq);
        }

        if (layers.air) {
          addFlights(viewer, air);
        }

        if (layers.sat) {
          addSatelliteRows(viewer, sat?.rows);
        }

        return;
      }

      /*
       * REPLAY MODE
       */
      if (mode === "replay" && layers.replay) {
        const activeEvents = events.filter(
          (event) => Date.parse(event.time) <= time
        );

        for (const event of activeEvents) {
          if (viewer.isDestroyed()) {
            return;
          }

          viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(
              Number(event.lon),
              Number(event.lat),
              0
            ),

            point: {
              pixelSize: 10,

              color:
                event.kind === "incident"
                  ? Cesium.Color.RED
                  : event.kind === "airspace"
                  ? Cesium.Color.YELLOW
                  : Cesium.Color.CYAN,

              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 1
            },

            properties: new Cesium.PropertyBag({
              type: event.kind,
              title: event.title,
              time: event.time,
              latitude: event.lat,
              longitude: event.lon
            })
          });
        }
      }
    } catch (error) {
      console.error(
        "WorldView layer rendering failed:",
        error
      );
    }
  }, [
    ready,
    mode,
    layers,
    eq,
    air,
    sat,
    events,
    time
  ]);

  /*
   * Location search.
   */
  async function search() {
    if (!q.trim()) {
      return;
    }

    try {
      const results = await geocode(q);

      const result = results?.[0];

      const viewer = vref.current;

      if (!result || !viewer || viewer.isDestroyed()) {
        return;
      }

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          Number(result.lon),
          Number(result.lat),
          260_000
        ),
        duration: 2
      });
    } catch (error) {
      console.warn("Location search failed:", error);
    }
  }

  return (
    <div className="app">
      <div className="globe" ref={el} />

      <div className="scanline" />

      <header>
        <div className="brand">
          <div className="mark">◎</div>

          <div>
            <div className="logo">WORLDVIEW</div>
            <div className="tag">
              LIVE OPEN-SOURCE SPATIAL INTELLIGENCE
            </div>
          </div>
        </div>

        <div className="search">
          <span>⌕</span>

          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                search();
              }
            }}
            placeholder="Search the world…"
          />

          <button onClick={search}>
            GO
          </button>
        </div>

        <div className="live">
          {ready ? "● LIVE" : "◌ BOOTING"}
        </div>
      </header>

      <nav className="rail">
        <button>☰</button>

        <button
          onClick={() => {
            const viewer = vref.current;

            if (viewer && !viewer.isDestroyed()) {
              viewer.camera.flyHome(1.5);
            }
          }}
        >
          ⌂
        </button>

        <button
          onClick={() => {
            setMode((current) =>
              current === "live" ? "replay" : "live"
            );
          }}
        >
          {mode === "live" ? "4D" : "LIVE"}
        </button>
      </nav>

      <aside className="stack">
        <div className="panel">
          <div className="k">
            WORLD STATUS
          </div>

          <h3>
            {mode === "replay"
              ? "4D REPLAY"
              : "LIVE MONITOR"}
          </h3>

          <div className="sub">
            {ready
              ? "Cesium/WebGL online"
              : "Initializing globe"}
          </div>
        </div>

        <div className="panel">
          <div className="k">
            LAYERS
          </div>

          {[
            ["eq", "EARTHQUAKES"],
            ["air", "AIRCRAFT"],
            ["sat", "SATELLITES"],
            ["replay", "REPLAY EVENTS"]
          ].map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>

              <input
                type="checkbox"
                checked={layers[key]}
                onChange={(event) => {
                  setLayers((current) => ({
                    ...current,
                    [key]: event.target.checked
                  }));
                }}
              />
            </label>
          ))}
        </div>

        <SourceStatus health={sources} />
      </aside>

      <div className="top-right">
        <div className="panel">
          <div className="k">
            EVENTS
          </div>

          <b>
            {mode === "replay"
              ? events.filter(
                  (event) =>
                    Date.parse(event.time) <= time
                ).length
              : eq?.features?.length ?? 0}
          </b>

          <span>
            {" "}
            ACTIVE OBJECTS
          </span>
        </div>
      </div>

      {selected && (
        <Inspector
          selected={selected}
          onClose={() => setSelected(null)}
        />
      )}

      <Timeline
        open={true}
        playing={play}
        setPlaying={setPlay}
        time={time}
        setTime={setTime}
        min={MIN}
        max={MAX}
        speed={speed}
        setSpeed={setSpeed}
        mode={mode}
        setMode={setMode}
      />

      <div className="footer">
        <span>
          WORLDVIEW / GOD'S-EYE-STYLE OPEN SOURCE BUILD
        </span>

        <span>
          PHASE 5 / 5
        </span>
      </div>
    </div>
  );
}

createRoot(
  document.getElementById("root")
).render(<App />);
