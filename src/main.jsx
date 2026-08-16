import React, {
  useEffect,
  useRef,
  useState
} from "react";

import {
  createRoot
} from "react-dom/client";

import * as Cesium
  from "cesium";

import "cesium/Build/Cesium/Widgets/widgets.css";

import {
  config,
  earthquakes,
  flights,
  geocode
} from "./data/api";

import {
  addEarthquakes
} from "./cesium/World";

import {
  addAircraft,
  removeMissingAircraft
} from "./cesium/Aircraft";

import {
  addLiveSatellites,
  removeMissingSatellites
} from "./cesium/Satellites";

import Timeline
  from "./components/Timeline";

import Inspector
  from "./components/Inspector";

import SourceStatus
  from "./components/SourceStatus";

import "./styles.css";

const MIN =
  Date.parse(
    "2026-08-16T08:00:00Z"
  );

const MAX =
  Date.parse(
    "2026-08-16T14:00:00Z"
  );

function App() {
  const globeElement =
    useRef(null);

  const viewerRef =
    useRef(null);

  /*
   * Live entity registries.
   */
  const aircraftEntities =
    useRef(new Map());

  const satelliteEntities =
    useRef(new Map());

  const [token, setToken] =
    useState("");

  const [ready, setReady] =
    useState(false);

  const [query, setQuery] =
    useState("");

  const [
    earthquakeData,
    setEarthquakeData
  ] = useState(null);

  const [
    aircraftData,
    setAircraftData
  ] = useState(null);

  const [
    satelliteCatalog,
    setSatelliteCatalog
  ] = useState([]);

  const [
    replayEvents,
    setReplayEvents
  ] = useState([]);

  const [
    selectedObject,
    setSelectedObject
  ] = useState(null);

  const [mode, setMode] =
    useState("live");

  const [
    currentTime,
    setCurrentTime
  ] = useState(MIN);

  const [
    playing,
    setPlaying
  ] = useState(false);

  const [
    playbackSpeed,
    setPlaybackSpeed
  ] = useState(15);

  const [layers, setLayers] =
    useState({
      eq: true,
      air: true,
      sat: true,
      replay: false
    });

  const [sources, setSources] =
    useState({
      USGS: "LOADING",
      OpenSky: "LOADING",
      CelesTrak: "LOADING"
    });

  /*
   * ============================================================
   * INITIAL CONFIG
   * ============================================================
   */

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const configuration =
          await config();

        if (!cancelled) {
          setToken(
            configuration?.cesiumIonToken ||
              ""
          );
        }
      } catch (error) {
        console.warn(
          "Config failed:",
          error
        );
      }

      try {
        const data =
          await earthquakes();

        if (!cancelled) {
          setEarthquakeData(
            data
          );

          setSources((current) => ({
            ...current,
            USGS: "ONLINE"
          }));
        }
      } catch (error) {
        setSources((current) => ({
          ...current,
          USGS: "ERROR"
        }));
      }

      try {
        const response =
          await fetch(
            "/api/replay/demo"
          );

        if (response.ok) {
          const data =
            await response.json();

          if (!cancelled) {
            setReplayEvents(
              data?.events || []
            );
          }
        }
      } catch {}
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * ============================================================
   * CESIUM
   * ============================================================
   */

  useEffect(() => {
    let viewer = null;
    let cancelled = false;

    async function initialize() {
      try {
        setReady(false);

        if (!globeElement.current) {
          return;
        }

        if (token) {
          Cesium.Ion.defaultAccessToken =
            token;
        }

        /*
         * Terrain.
         */

        let terrainProvider =
          new Cesium.EllipsoidTerrainProvider();

        if (token) {
          try {
            terrainProvider =
              await Cesium.CesiumTerrainProvider.fromIonAssetId(
                1
              );
          } catch (error) {
            console.warn(
              "Ion terrain unavailable:",
              error
            );
          }
        }

        /*
         * Imagery.
         *
         * IMPORTANT: baseLayer must be an ImageryLayer.
         */

        let baseLayer = null;

        if (token) {
          try {
            baseLayer =
              await Cesium.ImageryLayer.fromProviderAsync(
                Cesium.IonImageryProvider.fromAssetId(
                  2
                )
              );
          } catch (error) {
            console.warn(
              "Ion imagery unavailable:",
              error
            );
          }
        }

        /*
         * Fallback imagery.
         */

        if (!baseLayer) {
          try {
            const osmProvider =
              new Cesium.UrlTemplateImageryProvider(
                {
                  url:
                    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",

                  credit:
                    "© OpenStreetMap contributors",

                  maximumLevel: 19
                }
              );

            baseLayer =
              new Cesium.ImageryLayer(
                osmProvider
              );
          } catch {}
        }

        if (
          cancelled ||
          !globeElement.current
        ) {
          return;
        }

        viewer =
          new Cesium.Viewer(
            globeElement.current,
            {
              animation: false,

              baseLayer:
                baseLayer || false,

              baseLayerPicker:
                false,

              geocoder:
                false,

              homeButton:
                false,

              sceneModePicker:
                false,

              timeline:
                false,

              infoBox:
                false,

              selectionIndicator:
                false,

              terrainProvider,

              shouldAnimate:
                true
            }
          );

        /*
         * Visual atmosphere.
         */

        viewer.scene.globe.enableLighting =
          true;

        viewer.scene.skyAtmosphere.show =
          true;

        viewer.scene.fog.enabled =
          true;

        viewer.scene.postProcessStages
          .fxaa.enabled = true;

        viewer.scene.globe.showGroundAtmosphere =
          true;

        /*
         * Start camera.
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
         * Object selection.
         */

        viewer.screenSpaceEventHandler
          .setInputAction(
            (click) => {
              if (
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
              } catch {}
            },
            Cesium.ScreenSpaceEventType
              .LEFT_CLICK
          );

        viewerRef.current =
          viewer;

        setReady(true);
      } catch (error) {
        console.error(
          "Cesium initialization failed:",
          error
        );

        if (
          viewer &&
          !viewer.isDestroyed()
        ) {
          viewer.destroy();
        }

        viewerRef.current =
          null;

        setReady(false);
      }
    }

    initialize();

    return () => {
      cancelled = true;

      const oldViewer =
        viewerRef.current;

      viewerRef.current = null;

      if (
        oldViewer &&
        !oldViewer.isDestroyed()
      ) {
        oldViewer.destroy();
      }

      aircraftEntities.current.clear();
      satelliteEntities.current.clear();

      setReady(false);
    };
  }, [token]);

  /*
   * ============================================================
   * LIVE AIRCRAFT POLLING
   * ============================================================
   *
   * OpenSky snapshots are refreshed periodically.
   * Aircraft.js interpolates movement between snapshots.
   */

  useEffect(() => {
    if (!layers.air) {
      return;
    }

    let cancelled = false;

    async function refreshAircraft() {
      try {
        const data =
          await flights();

        if (
          cancelled
        ) {
          return;
        }

        setAircraftData(
          data
        );

        setSources((current) => ({
          ...current,
          OpenSky: "ONLINE"
        }));
      } catch (error) {
        console.warn(
          "Aircraft refresh failed:",
          error
        );

        if (!cancelled) {
          setSources((current) => ({
            ...current,
            OpenSky:
              "RATE LIMITED"
          }));
        }
      }
    }

    refreshAircraft();

    /*
     * Ten seconds is deliberately conservative.
     * OpenSky applies API credits/rate limits.
     */
    const interval =
      setInterval(
        refreshAircraft,
        10_000
      );

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [layers.air]);

  /*
   * ============================================================
   * LIVE SATELLITE CATALOG
   * ============================================================
   *
   * We do NOT repeatedly download orbital elements.
   *
   * We download the current orbital elements and then
   * satellite.js propagates each satellite continuously
   * inside the browser.
   */

  useEffect(() => {
    if (!layers.sat) {
      return;
    }

    let cancelled = false;

    async function loadSatellites() {
      try {
        const response =
          await fetch(
            "/api/data/satellite-catalog?group=visual"
          );

        if (!response.ok) {
          throw new Error(
            `Satellite catalog failed: ${response.status}`
          );
        }

        const data =
          await response.json();

        if (!cancelled) {
          setSatelliteCatalog(
            data?.rows || []
          );

          setSources((current) => ({
            ...current,
            CelesTrak: "ONLINE"
          }));
        }
      } catch (error) {
        console.warn(
          "Satellite catalog failed:",
          error
        );

        if (!cancelled) {
          setSources((current) => ({
            ...current,
            CelesTrak: "ERROR"
          }));
        }
      }
    }

    loadSatellites();

    /*
     * Refresh orbital elements every 30 minutes.
     * The positions themselves continue moving every frame.
     */
    const interval =
      setInterval(
        loadSatellites,
        30 * 60 * 1000
      );

    return () => {
      cancelled = true;

      clearInterval(
        interval
      );
    };
  }, [layers.sat]);

  /*
   * ============================================================
   * INITIAL LIVE EARTHQUAKE REFRESH
   * ============================================================
   */

  useEffect(() => {
    if (!layers.eq) {
      return;
    }

    let cancelled = false;

    async function refreshEarthquakes() {
      try {
        const data =
          await earthquakes();

        if (!cancelled) {
          setEarthquakeData(
            data
          );
        }
      } catch {}
    }

    const interval =
      setInterval(
        refreshEarthquakes,
        60_000
      );

    return () =>
      clearInterval(
        interval
      );
  }, [layers.eq]);

  /*
   * ============================================================
   * RENDER LIVE EARTHQUAKES
   * ============================================================
   */

  useEffect(() => {
    const viewer =
      viewerRef.current;

    if (
      !viewer ||
      !ready ||
      viewer.isDestroyed()
    ) {
      return;
    }

    /*
     * Earthquakes are event markers, so refreshing them
     * by rebuilding their layer is acceptable.
     *
     * Do NOT clear the whole entity collection here because
     * aircraft and satellites are dynamic.
     */

    const oldEarthquakes =
      viewer.entities.values
        .filter(
          (entity) =>
            entity.__worldviewType ===
            "earthquake"
        );

    for (
      const entity of
        oldEarthquakes
    ) {
      viewer.entities.remove(
        entity
      );
    }

    if (!layers.eq) {
      return;
    }

    try {
      const before =
        viewer.entities.values.length;

      addEarthquakes(
        viewer,
        earthquakeData
      );

      /*
       * Tag the newly created entities.
       */

      const created =
        viewer.entities.values.slice(
          before
        );

      for (
        const entity of
          created
      ) {
        entity.__worldviewType =
          "earthquake";
      }
    } catch (error) {
      console.warn(
        "Earthquake render failed:",
        error
      );
    }
  }, [
    earthquakeData,
    layers.eq,
    ready
  ]);

  /*
   * ============================================================
   * DYNAMIC AIRCRAFT
   * ============================================================
   */

  useEffect(() => {
    const viewer =
      viewerRef.current;

    if (
      !viewer ||
      !ready ||
      viewer.isDestroyed()
    ) {
      return;
    }

    if (!layers.air) {
      for (
        const entity of
          aircraftEntities.current.values()
      ) {
        viewer.entities.remove(
          entity
        );
      }

      aircraftEntities.current.clear();

      return;
    }

    if (!aircraftData) {
      return;
    }

    const states =
      (aircraftData.states ||
        [])
        .filter(Boolean)
        .map(
          (state) => ({
            icao24:
              state[0],

            callsign:
              state[1],

            country:
              state[2],

            longitude:
              state[5],

            latitude:
              state[6],

            altitude:
              state[7],

            onGround:
              state[8],

            velocity:
              state[9],

            heading:
              state[10],

            verticalRate:
              state[11]
          })
        )
        .filter(
          (aircraft) =>
            !aircraft.onGround &&
            Number.isFinite(
              Number(
                aircraft.longitude
              )
            ) &&
            Number.isFinite(
              Number(
                aircraft.latitude
              )
            )
        );

    const activeIds =
      new Set(
        states.map(
          (aircraft) =>
            aircraft.icao24
        )
      );

    addAircraft(
      viewer,
      states,
      aircraftEntities.current
    );

    removeMissingAircraft(
      viewer,
      aircraftEntities.current,
      activeIds
    );
  }, [
    aircraftData,
    layers.air,
    ready
  ]);

  /*
   * ============================================================
   * DYNAMIC SATELLITES
   * ============================================================
   */

  useEffect(() => {
    const viewer =
      viewerRef.current;

    if (
      !viewer ||
      !ready ||
      viewer.isDestroyed()
    ) {
      return;
    }

    if (!layers.sat) {
      for (
        const entity of
          satelliteEntities.current.values()
      ) {
        viewer.entities.remove(
          entity
        );
      }

      satelliteEntities.current.clear();

      return;
    }

    if (
      satelliteCatalog.length ===
      0
    ) {
      return;
    }

    const activeIds =
      new Set();

    for (
      const satellite of
        satelliteCatalog
    ) {
      activeIds.add(
        String(
          satellite.norad ||
          satellite.name
        )
      );
    }

    addLiveSatellites(
      viewer,
      satelliteCatalog,
      satelliteEntities.current
    );

    removeMissingSatellites(
      viewer,
      satelliteEntities.current,
      activeIds
    );
  }, [
    satelliteCatalog,
    layers.sat,
    ready
  ]);

  /*
   * ============================================================
   * 4D REPLAY
   * ============================================================
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

            if (
              next >= MAX
            ) {
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
   * ============================================================
   * REPLAY EVENTS
   * ============================================================
   */

  useEffect(() => {
    const viewer =
      viewerRef.current;

    if (
      !viewer ||
      !ready ||
      viewer.isDestroyed()
    ) {
      return;
    }

    const replayEntities =
      viewer.entities.values
        .filter(
          (entity) =>
            entity.__worldviewType ===
            "replay"
        );

    for (
      const entity of
        replayEntities
    ) {
      viewer.entities.remove(
        entity
      );
    }

    if (
      mode !== "replay" ||
      !layers.replay
    ) {
      return;
    }

    const activeEvents =
      replayEvents.filter(
        (event) =>
          Date.parse(
            event.time
          ) <= currentTime
      );

    for (
      const event of
        activeEvents
    ) {
      if (
        !Number.isFinite(
          Number(event.lat)
        ) ||
        !Number.isFinite(
          Number(event.lon)
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
      }

      const entity =
        viewer.entities.add({
          position:
            Cesium.Cartesian3.fromDegrees(
              Number(event.lon),
              Number(event.lat),
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

              latitude:
                Number(event.lat),

              longitude:
                Number(event.lon)
            })
        });

      entity.__worldviewType =
        "replay";
    }
  }, [
    replayEvents,
    currentTime,
    mode,
    layers.replay,
    ready
  ]);

  /*
   * ============================================================
   * SEARCH
   * ============================================================
   */

  async function searchWorld() {
    if (
      !query.trim()
    ) {
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

      viewer.camera.flyTo({
        destination:
          Cesium.Cartesian3.fromDegrees(
            Number(result.lon),
            Number(result.lat),
            260_000
          ),

        duration: 2
      });
    } catch (error) {
      console.warn(
        "Search failed:",
        error
      );
    }
  }

  /*
   * ============================================================
   * UI
   * ============================================================
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

          <span>
            ⌕
          </span>

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
            onClick={
              searchWorld
            }
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
                current ===
                "live"
                  ? "replay"
                  : "live"
            );
          }}
        >
          {mode ===
          "live"
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
            {mode ===
            "live"
              ? "LIVE MONITOR"
              : "4D REPLAY"}
          </h3>

          <div className="sub">
            {ready
              ? "Cesium/WebGL online"
              : "Initializing globe"}
          </div>

        </div>

        <div className="panel">

          <div className="k">
            LIVE LAYERS
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
            LIVE OBJECTS
          </div>

          <b>
            {mode ===
            "live"
              ?
                aircraftEntities
                  .current
                  .size +
                satelliteEntities
                  .current
                  .size
              :
                replayEvents.filter(
                  (event) =>
                    Date.parse(
                      event.time
                    ) <=
                    currentTime
                ).length}
          </b>

          <span>
            {" "}
            TRACKED
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
        open={
          mode ===
          "replay"
        }
        playing={
          playing
        }
        setPlaying={
          setPlaying
        }
        time={
          currentTime
        }
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
        mode={
          mode
        }
        setMode={
          setMode
        }
      />

      <div className="footer">

        <span>
          WORLDVIEW / LIVE ORBITAL + AIR TRAFFIC
        </span>

        <span>
          CESIUM · OPENSKY · CELESTRAK
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
