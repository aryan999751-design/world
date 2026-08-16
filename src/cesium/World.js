import * as Cesium from "cesium";

/*
 * Safely clear all entities.
 *
 * This prevents errors when React is updating while a Cesium viewer
 * is being destroyed/recreated.
 */
export function clear(viewer) {
  if (!viewer) {
    return;
  }

  if (
    typeof viewer.isDestroyed === "function" &&
    viewer.isDestroyed()
  ) {
    return;
  }

  if (!viewer.entities) {
    return;
  }

  try {
    viewer.entities.removeAll();
  } catch (error) {
    console.warn(
      "Unable to clear Cesium entities:",
      error
    );
  }
}

/*
 * Add USGS earthquake data.
 */
export function addEarthquakes(viewer, featureCollection) {
  if (!viewer) {
    return;
  }

  if (
    typeof viewer.isDestroyed === "function" &&
    viewer.isDestroyed()
  ) {
    return;
  }

  if (!viewer.entities) {
    return;
  }

  for (const feature of featureCollection?.features || []) {
    try {
      if (
        !feature.geometry ||
        !Array.isArray(feature.geometry.coordinates)
      ) {
        continue;
      }

      const [
        longitude,
        latitude,
        depth = 0
      ] = feature.geometry.coordinates;

      const magnitude = Number(
        feature.properties?.mag || 0
      );

      const title =
        feature.properties?.place ||
        "Earthquake";

      const eventTime =
        feature.properties?.time ?? null;

      viewer.entities.add({
        position:
          Cesium.Cartesian3.fromDegrees(
            Number(longitude),
            Number(latitude),
            0
          ),

        point: {
          pixelSize: Math.max(
            5,
            Math.min(
              24,
              magnitude * 4
            )
          ),

          color:
            Cesium.Color.ORANGERED.withAlpha(
              0.95
            ),

          outlineColor:
            Cesium.Color.WHITE.withAlpha(
              0.5
            ),

          outlineWidth: 1
        },

        properties:
          new Cesium.PropertyBag({
            type: "earthquake",
            title,
            magnitude,
            depth,
            latitude: Number(latitude),
            longitude: Number(longitude),
            time: eventTime
          })
      });
    } catch (error) {
      console.warn(
        "Failed to render earthquake:",
        error
      );
    }
  }
}

/*
 * Add OpenSky aircraft data.
 */
export function addFlights(viewer, data) {
  if (!viewer) {
    return;
  }

  if (
    typeof viewer.isDestroyed === "function" &&
    viewer.isDestroyed()
  ) {
    return;
  }

  if (!viewer.entities) {
    return;
  }

  for (const state of data?.states || []) {
    try {
      /*
       * OpenSky state vector indexes:
       *
       * 0 icao24
       * 1 callsign
       * 2 country
       * 5 longitude
       * 6 latitude
       * 7 barometric altitude
       * 9 velocity
       */
      const longitude = state[5];
      const latitude = state[6];

      if (
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude)
      ) {
        continue;
      }

      const altitude =
        Number.isFinite(state[7])
          ? Math.max(50, state[7])
          : 1000;

      const callsign =
        String(state[1] || state[0] || "").trim();

      viewer.entities.add({
        position:
          Cesium.Cartesian3.fromDegrees(
            longitude,
            latitude,
            altitude
          ),

        point: {
          pixelSize: 4,
          color: Cesium.Color.CYAN,

          outlineColor:
            Cesium.Color.BLACK,

          outlineWidth: 1
        },

        label: callsign
          ? {
              text: callsign,

              font:
                "10px ui-monospace, monospace",

              fillColor:
                Cesium.Color.WHITE,

              showBackground: true,

              backgroundColor:
                Cesium.Color.BLACK.withAlpha(
                  0.65
                ),

              pixelOffset:
                new Cesium.Cartesian2(
                  8,
                  0
                ),

              distanceDisplayCondition:
                new Cesium.DistanceDisplayCondition(
                  0,
                  7_000_000
                )
            }
          : undefined,

        properties:
          new Cesium.PropertyBag({
            type: "aircraft",

            title:
              callsign ||
              state[0] ||
              "Aircraft",

            icao24:
              state[0] || "",

            country:
              state[2] || "",

            longitude,

            latitude,

            altitude,

            velocity:
              state[9] ?? null
          })
      });
    } catch (error) {
      console.warn(
        "Failed to render aircraft:",
        error
      );
    }
  }
}
