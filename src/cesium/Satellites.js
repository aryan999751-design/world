import * as Cesium from "cesium";
import * as satellite from "satellite.js";

/*
|--------------------------------------------------------------------------
| Live Satellite Renderer
|--------------------------------------------------------------------------
|
| CelesTrak provides the orbital elements.
| satellite.js propagates those elements using SGP4.
|
| The result is a continuously moving satellite entity in Cesium.
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
| Create a propagated Cesium position
|--------------------------------------------------------------------------
*/

function createSatellitePositionProperty(
  satrec
) {
  return new Cesium.CallbackPositionProperty(
    (time, result) => {
      try {
        const date =
          Cesium.JulianDate.toDate(
            time
          );

        /*
         * SGP4 propagation.
         */
        const propagated =
          satellite.propagate(
            satrec,
            date
          );

        if (
          !propagated ||
          !propagated.position
        ) {
          return undefined;
        }

        /*
         * Convert ECI → geodetic coordinates.
         */
        const gmst =
          satellite.gstime(
            date
          );

        const geodetic =
          satellite.eciToGeodetic(
            propagated.position,
            gmst
          );

        const latitude =
          satellite.degreesLat(
            geodetic.latitude
          );

        const longitude =
          satellite.degreesLong(
            geodetic.longitude
          );

        /*
         * satellite.js height is kilometres.
         */
        const heightMeters =
          Number(
            geodetic.height
          ) * 1000;

        if (
          !Number.isFinite(
            latitude
          ) ||
          !Number.isFinite(
            longitude
          ) ||
          !Number.isFinite(
            heightMeters
          )
        ) {
          return undefined;
        }

        return Cesium.Cartesian3.fromDegrees(
          longitude,
          latitude,
          heightMeters,
          Cesium.Ellipsoid.WGS84,
          result
        );
      } catch (error) {
        /*
         * A single bad orbital record should never
         * crash the entire Cesium render loop.
         */
        return undefined;
      }
    },
    false
  );
}

/*
|--------------------------------------------------------------------------
| Add / update live satellites
|--------------------------------------------------------------------------
*/

export function addLiveSatellites(
  viewer,
  catalog,
  existingEntities = new Map()
) {
  if (
    !isViewerUsable(viewer)
  ) {
    return existingEntities;
  }

  if (
    !Array.isArray(catalog)
  ) {
    return existingEntities;
  }

  for (
    const record of catalog
  ) {
    try {
      /*
       * Satellite identification.
       */
      const name =
        record.name ||
        record.OBJECT_NAME ||
        record.OBJECT_NAME_EN ||
        record.NAME ||
        "Satellite";

      const norad =
        String(
          record.norad ||
          record.NORAD_CAT_ID ||
          record.OBJECT_ID ||
          name
        );

      /*
       * TLE fields.
       *
       * The backend normalizes these to TLE_LINE1/TLE_LINE2,
       * but the fallbacks make this renderer more tolerant.
       */
      const line1 =
        record.TLE_LINE1 ||
        record.LINE1 ||
        record.tle1 ||
        record.TLE1 ||
        "";

      const line2 =
        record.TLE_LINE2 ||
        record.LINE2 ||
        record.tle2 ||
        record.TLE2 ||
        "";

      if (
        !line1 ||
        !line2
      ) {
        continue;
      }

      /*
       * Build the SGP4 satellite record.
       */
      const satrec =
        satellite.twoline2satrec(
          line1,
          line2
        );

      if (!satrec) {
        continue;
      }

      /*
       * If the satellite already exists,
       * replace its orbital model but keep
       * its Cesium entity.
       */
      const existing =
        existingEntities.get(
          norad
        );

      if (existing) {
        existing.__worldviewSatrec =
          satrec;

        existing.__worldviewSatelliteData =
          {
            name,
            norad,
            TLE_LINE1:
              line1,
            TLE_LINE2:
              line2
          };

        continue;
      }

      /*
       * Dynamic position.
       *
       * Cesium evaluates this callback continuously,
       * so the satellite physically moves around Earth.
       */
      const position =
        createSatellitePositionProperty(
          satrec
        );

      /*
       * Create the Cesium entity.
       */
      const entity =
        viewer.entities.add({
          position,

          point: {
            pixelSize: 5,

            color:
              Cesium.Color.YELLOW,

            outlineColor:
              Cesium.Color.WHITE,

            outlineWidth: 1,

            disableDepthTestDistance:
              Number.POSITIVE_INFINITY
          },

          label: {
            text: name,

            font:
              "9px ui-monospace, monospace",

            fillColor:
              Cesium.Color.WHITE,

            showBackground:
              true,

            backgroundColor:
              Cesium.Color.BLACK.withAlpha(
                0.55
              ),

            pixelOffset:
              new Cesium.Cartesian2(
                8,
                0
              ),

            distanceDisplayCondition:
              new Cesium.DistanceDisplayCondition(
                0,
                7_500_000
              )
          },

          properties:
            new Cesium.PropertyBag({
              type:
                "satellite",

              title:
                name,

              norad,

              source:
                "CelesTrak",

              TLE_LINE1:
                line1,

              TLE_LINE2:
                line2
            })
        });

      /*
       * WorldView metadata.
       */
      entity.__worldviewType =
        "satellite";

      entity.__worldviewSource =
        "CelesTrak";

      entity.__worldviewSatrec =
        satrec;

      entity.__worldviewSatelliteData =
        {
          name,
          norad,
          TLE_LINE1:
            line1,
          TLE_LINE2:
            line2
        };

      existingEntities.set(
        norad,
        entity
      );
    } catch (error) {
      console.warn(
        "WorldView: failed to create satellite:",
        error
      );
    }
  }

  return existingEntities;
}

/*
|--------------------------------------------------------------------------
| Remove satellites that no longer exist in the catalog
|--------------------------------------------------------------------------
*/

export function removeMissingSatellites(
  viewer,
  entities,
  activeIds
) {
  if (
    !isViewerUsable(viewer)
  ) {
    return;
  }

  if (
    !(entities instanceof Map)
  ) {
    return;
  }

  if (
    !(activeIds instanceof Set)
  ) {
    return;
  }

  for (
    const [
      id,
      entity
    ] of entities
  ) {
    if (
      !activeIds.has(id)
    ) {
      try {
        viewer.entities.remove(
          entity
        );
      } catch {}

      entities.delete(
        id
      );
    }
  }
}

/*
|--------------------------------------------------------------------------
| Optional helper: remove every satellite
|--------------------------------------------------------------------------
*/

export function clearSatellites(
  viewer,
  entities
) {
  if (
    !isViewerUsable(viewer)
  ) {
    return;
  }

  if (
    !(entities instanceof Map)
  ) {
    return;
  }

  for (
    const entity of
      entities.values()
  ) {
    try {
      viewer.entities.remove(
        entity
      );
    } catch {}
  }

  entities.clear();
}
