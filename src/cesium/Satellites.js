import * as Cesium from "cesium";
import satellite from "satellite.js";

/*
 * Live satellite renderer.
 *
 * CelesTrak provides orbital elements.
 * satellite.js propagates those elements continuously
 * to calculate the satellite's current position.
 */

export function addLiveSatellites(
  viewer,
  catalog,
  existingEntities = new Map()
) {
  if (!viewer) {
    return existingEntities;
  }

  if (
    viewer.isDestroyed?.()
  ) {
    return existingEntities;
  }

  for (
    const record of catalog || []
  ) {
    const name =
      record.name ||
      record.OBJECT_NAME ||
      record.OBJECT_NAME_EN ||
      "Satellite";

    const norad =
      String(
        record.norad ||
        record.NORAD_CAT_ID ||
        record.OBJECT_ID ||
        name
      );

    const line1 =
      record.TLE_LINE1 ||
      record.line1 ||
      record.tle1;

    const line2 =
      record.TLE_LINE2 ||
      record.line2 ||
      record.tle2;

    if (
      !line1 ||
      !line2
    ) {
      continue;
    }

    /*
     * Build SGP4 model once.
     */
    let satrec;

    try {
      satrec =
        satellite.twoline2satrec(
          line1,
          line2
        );
    } catch (error) {
      console.warn(
        "Invalid satellite TLE:",
        name,
        error
      );

      continue;
    }

    const existing =
      existingEntities.get(
        norad
      );

    if (existing) {
      existing.__worldviewSatrec =
        satrec;

      existing.__worldviewSatelliteData = {
        name,
        norad,
        line1,
        line2
      };

      continue;
    }

    /*
     * Cesium requests a fresh position while rendering.
     */
    const position =
      new Cesium.CallbackPositionProperty(
        (time, result) => {
          try {
            const currentTime =
              Cesium.JulianDate.toDate(
                time
              );

            const propagated =
              satellite.propagate(
                satrec,
                currentTime
              );

            if (
              !propagated ||
              !propagated.position
            ) {
              return undefined;
            }

            const gmst =
              satellite.gstime(
                currentTime
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
            return undefined;
          }
        },
        false
      );

    const entity =
      viewer.entities.add({
        position,

        point: {
          pixelSize: 5,

          color:
            Cesium.Color.YELLOW,

          outlineColor:
            Cesium.Color.WHITE,

          outlineWidth: 1
        },

        label: {
          text: name,

          font:
            "9px ui-monospace, monospace",

          fillColor:
            Cesium.Color.WHITE,

          showBackground: true,

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
            type: "satellite",
            title: name,
            norad
          })
      });

    entity.__worldviewSatrec =
      satrec;

    entity.__worldviewSatelliteData = {
      name,
      norad,
      line1,
      line2
    };

    existingEntities.set(
      norad,
      entity
    );
  }

  return existingEntities;
}

export function removeMissingSatellites(
  viewer,
  entities,
  activeIds
) {
  if (
    !viewer ||
    viewer.isDestroyed?.()
  ) {
    return;
  }

  for (
    const [id, entity] of
      entities
  ) {
    if (
      !activeIds.has(id)
    ) {
      viewer.entities.remove(
        entity
      );

      entities.delete(id);
    }
  }
}
