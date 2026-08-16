import * as Cesium from "cesium";

/*
|--------------------------------------------------------------------------
| World.js
|--------------------------------------------------------------------------
| Shared Cesium helpers for static/event-based geospatial layers.
|
| Dynamic aircraft are handled by Aircraft.js.
| Dynamic satellites are handled by Satellites.js.
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Safety helpers
|--------------------------------------------------------------------------
*/

function isViewerUsable(viewer) {
  if (!viewer) {
    return false;
  }

  if (
    typeof viewer.isDestroyed === "function" &&
    viewer.isDestroyed()
  ) {
    return false;
  }

  if (!viewer.entities) {
    return false;
  }

  return true;
}

/*
|--------------------------------------------------------------------------
| Clear entities safely
|--------------------------------------------------------------------------
|
| IMPORTANT:
| Do not blindly call viewer.entities.removeAll().
| Aircraft and satellite layers are dynamic and are maintained by
| their own modules.
|
| This helper supports callers that intentionally want to clear
| the complete entity collection.
|--------------------------------------------------------------------------
*/

export function clear(viewer) {
  if (!isViewerUsable(viewer)) {
    return;
  }

  try {
    viewer.entities.removeAll();
  } catch (error) {
    console.warn(
      "WorldView: failed to clear Cesium entities:",
      error
    );
  }
}

/*
|--------------------------------------------------------------------------
| Remove entities belonging to a specific WorldView layer
|--------------------------------------------------------------------------
*/

export function clearLayer(
  viewer,
  layerType
) {
  if (!isViewerUsable(viewer)) {
    return;
  }

  try {
    const entities =
      viewer.entities.values.slice();

    for (const entity of entities) {
      if (
        entity &&
        entity.__worldviewType ===
          layerType
      ) {
        viewer.entities.remove(
          entity
        );
      }
    }
  } catch (error) {
    console.warn(
      `WorldView: failed to clear layer "${layerType}":`,
      error
    );
  }
}

/*
|--------------------------------------------------------------------------
| Earthquakes
|--------------------------------------------------------------------------
|
| Input:
| USGS GeoJSON FeatureCollection
|--------------------------------------------------------------------------
*/

export function addEarthquakes(
  viewer,
  featureCollection
) {
  if (!isViewerUsable(viewer)) {
    return [];
  }

  /*
   * Remove only the previous earthquake layer.
   *
   * This is critical because aircraft and satellites are
   * continuously moving and must not be removed.
   */
  clearLayer(
    viewer,
    "earthquake"
  );

  const createdEntities = [];

  const features =
    featureCollection?.features;

  if (!Array.isArray(features)) {
    return createdEntities;
  }

  for (const feature of features) {
    try {
      if (
        !feature ||
        !feature.geometry ||
        !Array.isArray(
          feature.geometry.coordinates
        )
      ) {
        continue;
      }

      const coordinates =
        feature.geometry.coordinates;

      const longitude =
        Number(coordinates[0]);

      const latitude =
        Number(coordinates[1]);

      const depth =
        Number(
          coordinates[2] || 0
        );

      if (
        !Number.isFinite(
          longitude
        ) ||
        !Number.isFinite(
          latitude
        )
      ) {
        continue;
      }

      const magnitude =
        Number(
          feature.properties?.mag ||
            0
        );

      const title =
        feature.properties
          ?.place ||
        "Earthquake";

      const eventTime =
        feature.properties
          ?.time ?? null;

      /*
       * Visual size based on magnitude.
       */
      const pixelSize =
        Math.max(
          5,
          Math.min(
            28,
            magnitude * 4
          )
        );

      /*
       * Main earthquake marker.
       */
      const entity =
        viewer.entities.add({
          position:
            Cesium.Cartesian3.fromDegrees(
              longitude,
              latitude,
              0
            ),

          point: {
            pixelSize,

            color:
              Cesium.Color.ORANGERED.withAlpha(
                0.95
              ),

            outlineColor:
              Cesium.Color.WHITE.withAlpha(
                0.65
              ),

            outlineWidth: 1,

            disableDepthTestDistance:
              Number.POSITIVE_INFINITY
          },

          /*
           * A small label becomes visible when the
           * user is sufficiently close to the region.
           */
          label:
            magnitude >= 4.5
              ? {
                  text:
                    `M${magnitude.toFixed(
                      1
                    )}`,

                  font:
                    "10px ui-monospace, monospace",

                  fillColor:
                    Cesium.Color.WHITE,

                  showBackground:
                    true,

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
                      5_000_000
                    )
                }
              : undefined,

          properties:
            new Cesium.PropertyBag({
              type:
                "earthquake",

              category:
                "seismic",

              title,

              magnitude,

              depth,

              latitude,

              longitude,

              time:
                eventTime,

              source:
                "USGS",

              sourceUrl:
                feature.properties
                  ?.url ||
                ""
            })
        });

      /*
       * Layer identification.
       */
      entity.__worldviewType =
        "earthquake";

      entity.__worldviewSource =
        "USGS";

      entity.__worldviewRaw =
        feature;

      createdEntities.push(
        entity
      );
    } catch (error) {
      console.warn(
        "WorldView: failed to render earthquake:",
        error
      );
    }
  }

  return createdEntities;
}

/*
|--------------------------------------------------------------------------
| Generic geographic point layer
|--------------------------------------------------------------------------
|
| Useful for future data providers:
| volcanoes, weather stations, incidents, sensors, etc.
|--------------------------------------------------------------------------
*/

export function addPointLayer(
  viewer,
  points,
  options = {}
) {
  if (!isViewerUsable(viewer)) {
    return [];
  }

  const {
    type = "point",
    color =
      Cesium.Color.CYAN,
    pixelSize = 6,
    label = false,
    source = "unknown"
  } = options;

  /*
   * Clear only this layer.
   */
  clearLayer(
    viewer,
    type
  );

  const created = [];

  for (const point of points || []) {
    try {
      const longitude =
        Number(
          point.longitude ??
            point.lon
        );

      const latitude =
        Number(
          point.latitude ??
            point.lat
        );

      const altitude =
        Number(
          point.altitude ??
            point.height ??
            0
        );

      if (
        !Number.isFinite(
          longitude
        ) ||
        !Number.isFinite(
          latitude
        )
      ) {
        continue;
      }

      const entity =
        viewer.entities.add({
          position:
            Cesium.Cartesian3.fromDegrees(
              longitude,
              latitude,
              altitude
            ),

          point: {
            pixelSize,

            color,

            outlineColor:
              Cesium.Color.WHITE.withAlpha(
                0.6
              ),

            outlineWidth: 1
          },

          label:
            label &&
            point.title
              ? {
                  text:
                    String(
                      point.title
                    ),

                  font:
                    "10px ui-monospace, monospace",

                  fillColor:
                    Cesium.Color.WHITE,

                  showBackground:
                    true,

                  backgroundColor:
                    Cesium.Color.BLACK.withAlpha(
                      0.6
                    ),

                  pixelOffset:
                    new Cesium.Cartesian2(
                      8,
                      0
                    ),

                  distanceDisplayCondition:
                    new Cesium.DistanceDisplayCondition(
                      0,
                      5_000_000
                    )
                }
              : undefined,

          properties:
            new Cesium.PropertyBag({
              type,

              title:
                point.title ||
                type,

              latitude,

              longitude,

              altitude,

              source
            })
        });

      entity.__worldviewType =
        type;

      entity.__worldviewSource =
        source;

      entity.__worldviewRaw =
        point;

      created.push(
        entity
      );
    } catch (error) {
      console.warn(
        `WorldView: failed to render ${type}:`,
        error
      );
    }
  }

  return created;
}

/*
|--------------------------------------------------------------------------
| GeoJSON point / line / polygon layer
|--------------------------------------------------------------------------
|
| Supports future:
| - airspace
| - GPS interference
| - maritime zones
| - AOIs
| - event footprints
|--------------------------------------------------------------------------
*/

export function addGeoJsonLayer(
  viewer,
  featureCollection,
  options = {}
) {
  if (!isViewerUsable(viewer)) {
    return null;
  }

  const {
    type = "geojson",
    source = "unknown",
    stroke =
      Cesium.Color.CYAN,
    fill =
      Cesium.Color.CYAN.withAlpha(
        0.12
      ),
    strokeWidth = 2
  } = options;

  /*
   * Remove previous layer first.
   */
  clearLayer(
    viewer,
    type
  );

  const features =
    featureCollection?.features;

  if (!Array.isArray(features)) {
    return null;
  }

  /*
   * Render each feature individually so that it can later be
   * selected and correlated.
   */
  for (const feature of features) {
    try {
      const geometry =
        feature?.geometry;

      if (!geometry) {
        continue;
      }

      const coordinates =
        geometry.coordinates;

      const properties =
        feature.properties || {};

      let entity = null;

      switch (
        geometry.type
      ) {
        /*
         * ------------------------------------------------------
         * POINT
         * ------------------------------------------------------
         */

        case "Point": {
          const [
            longitude,
            latitude,
            altitude = 0
          ] = coordinates;

          entity =
            viewer.entities.add({
              position:
                Cesium.Cartesian3.fromDegrees(
                  Number(longitude),
                  Number(latitude),
                  Number(altitude)
                ),

              point: {
                pixelSize: 7,
                color: stroke,

                outlineColor:
                  Cesium.Color.WHITE.withAlpha(
                    0.65
                  ),

                outlineWidth: 1
              },

              properties:
                new Cesium.PropertyBag({
                  type,

                  title:
                    properties.title ||
                    properties.name ||
                    type,

                  source,

                  ...properties
                })
            });

          break;
        }

        /*
         * ------------------------------------------------------
         * LINESTRING
         * ------------------------------------------------------
         */

        case "LineString": {
          const positions =
            coordinates.map(
              (coordinate) =>
                Cesium.Cartesian3.fromDegrees(
                  Number(
                    coordinate[0]
                  ),
                  Number(
                    coordinate[1]
                  ),
                  Number(
                    coordinate[2] ||
                      0
                  )
                )
            );

          entity =
            viewer.entities.add({
              polyline: {
                positions,

                width:
                  strokeWidth,

                material:
                  stroke
              },

              properties:
                new Cesium.PropertyBag({
                  type,

                  title:
                    properties.title ||
                    properties.name ||
                    type,

                  source,

                  ...properties
                })
            });

          break;
        }

        /*
         * ------------------------------------------------------
         * POLYGON
         * ------------------------------------------------------
         */

        case "Polygon": {
          const ring =
            coordinates?.[0];

          if (
            !Array.isArray(ring) ||
            ring.length < 3
          ) {
            break;
          }

          const positions =
            ring.map(
              (coordinate) =>
                Cesium.Cartesian3.fromDegrees(
                  Number(
                    coordinate[0]
                  ),
                  Number(
                    coordinate[1]
                  ),
                  Number(
                    coordinate[2] ||
                      0
                  )
                )
            );

          entity =
            viewer.entities.add({
              polygon: {
                hierarchy:
                  new Cesium.PolygonHierarchy(
                    positions
                  ),

                material:
                  fill,

                outline: true,

                outlineColor:
                  stroke,

                outlineWidth:
                  strokeWidth
              },

              properties:
                new Cesium.PropertyBag({
                  type,

                  title:
                    properties.title ||
                    properties.name ||
                    type,

                  source,

                  ...properties
                })
            });

          break;
        }

        default:
          console.warn(
            `WorldView: unsupported GeoJSON geometry "${geometry.type}".`
          );
      }

      if (entity) {
        entity.__worldviewType =
          type;

        entity.__worldviewSource =
          source;

        entity.__worldviewRaw =
          feature;
      }
    } catch (error) {
      console.warn(
        "WorldView: failed to render GeoJSON feature:",
        error
      );
    }
  }

  return true;
}

/*
|--------------------------------------------------------------------------
| Camera helpers
|--------------------------------------------------------------------------
*/

/*
 * Fly to a geographic location.
 */
export function flyToLocation(
  viewer,
  longitude,
  latitude,
  height = 250_000,
  duration = 2
) {
  if (!isViewerUsable(viewer)) {
    return;
  }

  if (
    !Number.isFinite(
      Number(longitude)
    ) ||
    !Number.isFinite(
      Number(latitude)
    )
  ) {
    return;
  }

  try {
    viewer.camera.flyTo({
      destination:
        Cesium.Cartesian3.fromDegrees(
          Number(longitude),
          Number(latitude),
          Number(height)
        ),

      duration
    });
  } catch (error) {
    console.warn(
      "WorldView: camera flight failed:",
      error
    );
  }
}

/*
 * Center over the user's primary region / AOI.
 */
export function centerWorld(
  viewer,
  longitude = 51,
  latitude = 30,
  height = 5_500_000
) {
  flyToLocation(
    viewer,
    longitude,
    latitude,
    height,
    1.8
  );
}

/*
 * Fly home to the global Earth view.
 */
export function flyHome(
  viewer,
  duration = 1.5
) {
  if (!isViewerUsable(viewer)) {
    return;
  }

  try {
    viewer.camera.flyHome(
      duration
    );
  } catch (error) {
    console.warn(
      "WorldView: flyHome failed:",
      error
    );
  }
}

/*
|--------------------------------------------------------------------------
| Request rendering
|--------------------------------------------------------------------------
|
| Useful when dynamic callbacks update between Cesium render passes.
|--------------------------------------------------------------------------
*/

export function requestRender(
  viewer
) {
  if (!viewer) {
    return;
  }

  if (
    viewer.isDestroyed?.()
  ) {
    return;
  }

  try {
    viewer.scene.requestRender();
  } catch {}
}
