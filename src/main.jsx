import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Cesium from "cesium";

import "cesium/Build/Cesium/Widgets/widgets.css";

import { config, earthquakes, flights, geocode } from "./data/api";
import {
  addEarthquakes,
  addFlights,
  clear
} from "./cesium/World";
import { addSatelliteRows } from "./cesium/Satellites";

import Timeline from "./components/Timeline";
import Inspector from "./components/Inspector";
import SourceStatus from "./components/SourceStatus";

import "./styles.css";

const MIN = Date.parse("2026-08-16T08:00:00Z");
const MAX = Date.parse("2026-08-16T14:00:00Z");

function App() {
  const globeElement = useRef(null);
  const viewerRef = useRef(null);

  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);

  const [query, setQuery] = useState("");

  const [earthquakeData, setEarthquakeData] = useState(null);
  const [aircraftData, setAircraftData] = useState(null);
  const [satelliteData, setSatelliteData] = useState(null);

  const [replayEvents, setReplayEvents] = useState([]);
  const [selectedObject, setSelectedObject] = useState(null);

  const [mode, setMode] = useState("replay");

  const [currentTime, setCurrentTime] = useState(MIN);
  const [playing, setPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(15);

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
   * ------------------------------------------------------------
   * LOAD INITIAL CONFIGURATION + DATA
   * ------------------------------------------------------------
   */

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      /*
       * Load Cesium configuration
       */
      try {
        const configuration = await config();

        if (!cancelled) {
          setToken(
            configuration?.cesiumIonToken || ""
          );
        }
      } catch (error) {
        console.error(
          "WorldView configuration failed:",
          error
        );

        if (!cancelled) {
          setToken("");
        }
      }

      /*
       * Load earthquake data
       */
      try {
        const data = await earthquakes();

        if (!cancelled) {
          setEarthquakeData(data);

          setSources((current) => ({
            ...current,
            USGS: "ONLINE"
          }));
        }
      } catch (error) {
        console.warn(
          "USGS earthquake feed unavailable:",
          error
        );

        if (!cancelled) {
          setSources((current) => ({
            ...current,
            USGS: "ERROR"
          }));
        }
      }

      /*
       * Load replay scenario
       */
      try {
        const response = await fetch(
          "/api/replay/demo"
        );

        if (!response.ok) {
          throw new Error(
            `Replay request failed: ${response.status}`
          );
        }

        const data = await response.json();

        if (!cancelled) {
          setReplayEvents(
            Array.isArray(data?.events)
              ? data.events
              : []
          );
        }
      } catch (error) {
        console.warn(
          "Replay data unavailable:",
          error
        );
      }
    }

    loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * ------------------------------------------------------------
   * AIRCRAFT DATA
   * ------------------------------------------------------------
   */

  useEffect(() => {
    if (!layers.air) {
      return;
    }

    let cancelled = false;

    flights()
      .then((data) => {
        if (cancelled) {
          return;
        }

        setAircraftData(data);

        setSources((current) => ({
          ...current,
          OpenSky: "ONLINE"
        }));
      })
      .catch((error) => {
        console.warn(
          "OpenSky aircraft feed unavailable:",
          error
        );

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
   * ------------------------------------------------------------
   * SATELLITE DATA
   * ------------------------------------------------------------
   */

  useEffect(() => {
    if (!layers.sat) {
      return;
    }

    let cancelled = false;

    fetch(
      "/api/data/satellite-positions?group=visual"
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Satellite request failed: ${response.status}`
          );
        }

        return response.json();
      })
      .then((data) => {
        if (cancelled) {
          return;
        }

        setSatelliteData(data);

        setSources((current) => ({
          ...current,
          CelesTrak: "ONLINE"
        }));
      })
      .catch((error) => {
        console.warn(
          "CelesTrak satellite feed unavailable:",
          error
        );

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
   * ------------------------------------------------------------
   * CESIUM VIEWER
   *
   * IMPORTANT FIX:
   *
   * Viewer.baseLayer MUST receive an ImageryLayer.
   *
   * It must NOT receive IonImageryProvider directly.
   * ------------------------------------------------------------
   */

  useEffect(() => {
    let viewer = null;
    let cancelled = false;

    async function initializeGlobe() {
      try {
        setReady(false);

        if (!globeElement.current) {
          return;
        }

        /*
         * Configure Cesium Ion when a token exists.
         */
        if (token) {
          Cesium.Ion.defaultAccessToken = token;
        }

        /*
         * --------------------------------------------------------
         * TERRAIN
         * --------------------------------------------------------
         *
         * Start with the safe ellipsoid fallback.
         */

        let terrainProvider =
          new Cesium.EllipsoidTerrainProvider();

        if (token) {
          try {
            terrainProvider =
              await Cesium.CesiumTerrainProvider.fromIonAssetId(
                1
              );

            console.info(
              "WorldView: Cesium World Terrain loaded."
            );
          } catch (error) {
            console.warn(
              "WorldView: Cesium Ion terrain failed. Using ellipsoid fallback.",
              error
            );

            terrainProvider =
              new Cesium.EllipsoidTerrainProvider();
          }
        }

        /*
         * --------------------------------------------------------
         * IMAGERY
         * --------------------------------------------------------
         *
         * This is the critical fix.
         *
         * We create an ImageryLayer and give that to Viewer.
         */

        let baseLayer = null;

        if (token) {
          try {
            /*
             * IonImageryProvider
             *        ↓
             * ImageryLayer.fromProviderAsync()
             *        ↓
             * ImageryLayer
             */
            baseLayer =
              await Cesium.ImageryLayer.fromProviderAsync(
                Cesium.IonImageryProvider.fromAssetId(2)
              );

            console.info(
              "WorldView: Cesium Ion World Imagery loaded."
            );
          } catch (error) {
            console.warn(
              "WorldView: Cesium Ion imagery failed. Falling back to OpenStreetMap.",
              error
            );
          }
        }

        /*
         * If Ion imagery failed or there is no Ion token,
         * create a real ImageryLayer using OSM.
         *
         * This is NOT passed directly to Viewer.
         */
        if (!baseLayer) {
          try {
            const osmProvider =
              new Cesium.UrlTemplateImageryProvider({
                url:
                  "https://tile.openstreetmap.org/{z}/{x}/{y}.png",

                credit:
                  "© OpenStreetMap contributors",

                maximumLevel: 19
              });

            baseLayer =
              new Cesium.ImageryLayer(
                osmProvider
              );

            console.info(
              "WorldView: OpenStreetMap imagery fallback loaded."
            );
          } catch (error) {
            console.warn(
              "WorldView: OSM imagery fallback failed:",
              error
            );

            baseLayer = null;
          }
        }

        /*
         * React may have unmounted while the async
         * terrain/imagery requests were running.
         */
        if (
          cancelled ||
          !globeElement.current
        ) {
          return;
        }

        /*
         * --------------------------------------------------------
         * CREATE CESIUM VIEWER
         * --------------------------------------------------------
         */

        viewer = new Cesium.Viewer(
          globeElement.current,
          {
            animation: false,

            /*
             * IMPORTANT:
             *
             * baseLayer is now a REAL ImageryLayer.
             */
            baseLayer:
              baseLayer || false,

            baseLayerPicker: false,

            geocoder: false,

            homeButton: false,

            sceneModePicker: false,

            timeline: false,

            infoBox: false,

            selectionIndicator: false,

            terrainProvider,

            shouldAnimate: true
          }
        );

        /*
         * --------------------------------------------------------
         * VISUAL SETTINGS
         * --------------------------------------------------------
         */

        viewer.scene.globe.enableLighting =
          true;

        viewer.scene.skyAtmosphere.show =
          true;

        viewer.scene.fog.enabled =
          true;

        viewer.scene.postProcessStages
          .fxaa.enabled = true;

        /*
         * Make the Earth visually immersive.
         */

        viewer.scene.globe.showGroundAtmosphere =
          true;

        /*
         * --------------------------------------------------------
         * INITIAL CAMERA
         * --------------------------------------------------------
         */

        viewer.camera.flyTo({
          destination:
            Cesium.Cartesian3.fromDegrees(
              44,
              28,
              16_500_000
            ),

          duration: 2
        });

        /*
         * --------------------------------------------------------
         * OBJECT CLICK HANDLER
         * --------------------------------------------------------
         */

        viewer.screenSpaceEventHandler.setInputAction(
          (click) => {
            if (
              !viewer ||
              viewer.isDestroyed()
            ) {
              return;
            }

            try {
              const picked =
                viewer.scene.pick(
                  click.position
                );

              if (
                !picked ||
                !picked.id
              ) {
                return;
              }

              const properties =
                picked.id.properties;

              if (!properties) {
                return;
              }

              const object = {};

              for (
                const propertyName of
                  properties.propertyNames
              ) {
                object[propertyName] =
                  properties.getValue(
                    viewer.clock.currentTime
                  );
              }

              setSelectedObject(
                object
              );
            } catch (error) {
              console.warn(
                "WorldView object selection failed:",
                error
              );
            }
          },
          Cesium.ScreenSpaceEventType
            .LEFT_CLICK
        );

        /*
         * --------------------------------------------------------
         * STORE ACTIVE VIEWER
         * --------------------------------------------------------
         */

        if (
          !cancelled &&
          viewer &&
          !viewer.isDestroyed()
        ) {
          viewerRef.current =
            viewer;

          setReady(true);
        }
      } catch (error) {
        console.error(
          "WorldView Cesium initialization failed:",
          error
        );

        viewerRef.current =
          null;

        if (
          viewer &&
          !viewer.isDestroyed()
        ) {
          try {
            viewer.destroy();
          } catch (destroyError) {
            console.warn(
              "Cesium cleanup failed:",
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

    initializeGlobe();

    /*
     * --------------------------------------------------------
     * CLEANUP
     * --------------------------------------------------------
     */

    return () => {
      cancelled = true;

      setReady(false);

      const activeViewer =
        viewerRef.current;

      /*
       * Clear the ref BEFORE destroying
       * the viewer.
       *
       * This prevents another React effect
       * from using a stale Cesium instance.
       */
      viewerRef.current =
        null;

      if (
        activeViewer &&
        !activeViewer.isDestroyed()
      ) {
        try {
          activeViewer.destroy();
        } catch (error) {
          console.warn(
            "WorldView viewer cleanup failed:",
            error
          );
        }
      }

      viewer = null;
    };
  }, [token]);

  /*
   * ------------------------------------------------------------
   * 4D PLAYBACK CLOCK
   * ------------------------------------------------------------
   */

  useEffect(() => {
    if (
      !playing ||
      mode !== "replay"
    ) {
      return;
    }

    const timer =
      setInterval(() => {
        setCurrentTime(
          (time) => {
            const next =
              time +
              1000 *
                playbackSpeed;

            if (next >= MAX) {
              return MIN;
            }

            return next;
          }
        );
      }, 1000);

    return () =>
      clearInterval(timer);
  }, [
    playing,
    playbackSpeed,
    mode
  ]);

  /*
   * ------------------------------------------------------------
   * RENDER WORLD LAYERS
   * ------------------------------------------------------------
   */

  useEffect(() => {
    const viewer =
      viewerRef.current;

    if (!viewer) {
      return;
    }

    if (!ready) {
      return;
    }

    if (
      typeof viewer.isDestroyed ===
        "function" &&
      viewer.isDestroyed()
    ) {
      return;
    }

    try {
      /*
       * Safely clear existing entities.
       */
      clear(viewer);

      /*
       * --------------------------------------------------------
       * LIVE MODE
       * --------------------------------------------------------
       */

      if (mode === "live") {
        if (layers.eq) {
          addEarthquakes(
            viewer,
            earthquakeData
          );
        }

        if (layers.air) {
          addFlights(
            viewer,
            aircraftData
          );
        }

        if (layers.sat) {
          addSatelliteRows(
            viewer,
            satelliteData?.rows
          );
        }

        return;
      }

      /*
       * --------------------------------------------------------
       * REPLAY MODE
       * --------------------------------------------------------
       */

      if (
        mode === "replay" &&
        layers.replay
      ) {
        const activeEvents =
          replayEvents.filter(
            (event) =>
              Date.parse(
                event.time
              ) <= currentTime
          );

        for (
          const event of activeEvents
        ) {
          if (
            viewer.isDestroyed()
          ) {
            return;
          }

          const latitude =
            Number(event.lat);

          const longitude =
            Number(event.lon);

          if (
            !Number.isFinite(
              latitude
            ) ||
            !Number.isFinite(
              longitude
            )
          ) {
            continue;
          }

          let color =
            Cesium.Color.CYAN;

          if (
            event.kind ===
            "incident"
          ) {
            color =
              Cesium.Color.RED;
          } else if (
            event.kind ===
            "airspace"
          ) {
            color =
              Cesium.Color.YELLOW;
          } else if (
            event.kind ===
            "maritime"
          ) {
            color =
              Cesium.Color.BLUE;
          } else if (
            event.kind ===
            "satellite"
          ) {
            color =
              Cesium.Color.YELLOW;
          }

          viewer.entities.add({
            position:
              Cesium.Cartesian3.fromDegrees(
                longitude,
                latitude,
                0
              ),

            point: {
              pixelSize: 10,

              color,

              outlineColor:
                Cesium.Color.WHITE,

              outlineWidth: 1
            },

            properties:
              new Cesium.PropertyBag({
                type:
                  event.kind,

                title:
                  event.title,

                time:
                  event.time,

                latitude,

                longitude
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
    earthquakeData,
    aircraftData,
    satelliteData,
    replayEvents,
    currentTime
  ]);

  /*
   * ------------------------------------------------------------
   * SEARCH
   * ------------------------------------------------------------
   */

  async function searchWorld() {
    if (!query.trim()) {
      return;
    }

    try {
      const results =
        await geocode(
          query.trim()
        );

      const result =
        results?.[0];

      const viewer =
        viewerRef.current;

      if (
        !result ||
        !viewer ||
        viewer.isDestroyed()
      ) {
        return;
      }

      const longitude =
        Number(result.lon);

      const latitude =
        Number(result.lat);

      if (
        !Number.isFinite(
          longitude
        ) ||
        !Number.isFinite(
          latitude
        )
      ) {
        return;
      }

      viewer.camera.flyTo({
        destination:
          Cesium.Cartesian3.fromDegrees(
            longitude,
            latitude,
            260_000
          ),

        duration: 2
      });
    } catch (error) {
      console.warn(
        "WorldView search failed:",
        error
      );
    }
  }

  /*
   * ------------------------------------------------------------
   * UI
   * ------------------------------------------------------------
   */

  return (
    <div className="app">
      <div
        className="globe"
        ref={globeElement}
      />

      <div className="scanline" />

      <header>
        <div className="brand">
          <div className="mark">
            ◎
          </div>

          <div>
            <div className="logo">
              WORLDVIEW
            </div>

            <div className="tag">
              LIVE OPEN-SOURCE
              SPATIAL INTELLIGENCE
            </div>
          </div>
        </div>

        <div className="search">
          <span>⌕</span>

          <input
            value={query}
            onChange={(event) =>
              setQuery(
                event.target.value
              )
            }
            onKeyDown={(event) => {
              if (
                event.key ===
                "Enter"
              ) {
                searchWorld();
              }
            }}
            placeholder="Search the world…"
          />

          <button
            onClick={searchWorld}
          >
            GO
          </button>
        </div>

        <div className="live">
          {ready
            ? "● LIVE"
            : "◌ BOOTING"}
        </div>
      </header>

      <nav className="rail">
        <button>
          ☰
        </button>

        <button
          onClick={() => {
            const viewer =
              viewerRef.current;

            if (
              viewer &&
              !viewer.isDestroyed()
            ) {
              viewer.camera.flyHome(
                1.5
              );
            }
          }}
        >
          ⌂
        </button>

        <button
          onClick={() => {
            setMode(
              (current) =>
                current === "live"
                  ? "replay"
                  : "live"
            );
          }}
        >
          {mode === "live"
            ? "4D"
            : "LIVE"}
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
            [
              "replay",
              "REPLAY EVENTS"
            ]
          ].map(
            ([key, label]) => (
              <label
                key={key}
              >
                <span>
                  {label}
                </span>

                <input
                  type="checkbox"
                  checked={
                    layers[key]
                  }
                  onChange={(
                    event
                  ) => {
                    setLayers(
                      (current) => ({
                        ...current,

                        [key]:
                          event
                            .target
                            .checked
                      })
                    );
                  }}
                />
              </label>
            )
          )}
        </div>

        <SourceStatus
          health={sources}
        />
      </aside>

      <div className="top-right">
        <div className="panel">
          <div className="k">
            EVENTS
          </div>

          <b>
            {mode === "replay"
              ? replayEvents.filter(
                  (event) =>
                    Date.parse(
                      event.time
                    ) <=
                    currentTime
                ).length
              : earthquakeData
                  ?.features
                  ?.length ??
                0}
          </b>

          <span>
            {" "}
            ACTIVE OBJECTS
          </span>
        </div>
      </div>

      {selectedObject && (
        <Inspector
          selected={
            selectedObject
          }
          onClose={() =>
            setSelectedObject(
              null
            )
          }
        />
      )}

      <Timeline
        open={true}
        playing={playing}
        setPlaying={
          setPlaying
        }
        time={currentTime}
        setTime={
          setCurrentTime
        }
        min={MIN}
        max={MAX}
        speed={
          playbackSpeed
        }
        setSpeed={
          setPlaybackSpeed
        }
        mode={mode}
        setMode={setMode}
      />

      <div className="footer">
        <span>
          WORLDVIEW /
          GOD'S-EYE-STYLE
          OPEN SOURCE BUILD
        </span>

        <span>
          PHASE 5 / 5
        </span>
      </div>
    </div>
  );
}

createRoot(
  document.getElementById(
    "root"
  )
).render(
  <App />
);
