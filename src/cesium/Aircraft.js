import * as Cesium from "cesium";

/*
 * Aircraft live-motion renderer.
 *
 * OpenSky gives us a position + speed + heading snapshot.
 * We use that snapshot to continuously extrapolate the aircraft
 * between API updates instead of making planes jump every poll.
 */

const EARTH_RADIUS = 6378137;

function destinationPoint(
  latitude,
  longitude,
  distanceMeters,
  bearingDegrees
) {
  const lat1 =
    Cesium.Math.toRadians(latitude);

  const lon1 =
    Cesium.Math.toRadians(longitude);

  const bearing =
    Cesium.Math.toRadians(bearingDegrees);

  const angularDistance =
    distanceMeters / EARTH_RADIUS;

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);

  const sinAngular =
    Math.sin(angularDistance);

  const cosAngular =
    Math.cos(angularDistance);

  const sinLat2 =
    sinLat1 * cosAngular +
    cosLat1 *
      sinAngular *
      Math.cos(bearing);

  const lat2 =
    Math.asin(
      Math.max(
        -1,
        Math.min(1, sinLat2)
      )
    );

  const y =
    Math.sin(bearing) *
    sinAngular *
    cosLat1;

  const x =
    cosAngular -
    sinLat1 * Math.sin(lat2);

  const lon2 =
    lon1 +
    Math.atan2(y, x);

  return {
    latitude:
      Cesium.Math.toDegrees(lat2),

    longitude:
      Cesium.Math.toDegrees(lon2)
  };
}

function extrapolateAircraft(
  aircraft,
  elapsedSeconds
) {
  const latitude =
    Number(aircraft.latitude);

  const longitude =
    Number(aircraft.longitude);

  const velocity =
    Number(aircraft.velocity || 0);

  const heading =
    Number(aircraft.heading || 0);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }

  if (
    !Number.isFinite(velocity) ||
    velocity <= 1 ||
    !Number.isFinite(heading)
  ) {
    return {
      latitude,
      longitude
    };
  }

  /*
   * Limit extrapolation so a temporarily stale API response
   * doesn't send an aircraft halfway around the world.
   */
  const safeElapsed =
    Math.max(
      0,
      Math.min(
        elapsedSeconds,
        30
      )
    );

  const distance =
    velocity * safeElapsed;

  return destinationPoint(
    latitude,
    longitude,
    distance,
    heading
  );
}

export function addAircraft(
  viewer,
  aircraftList,
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

  const now =
    Date.now();

  for (
    const aircraft of aircraftList || []
  ) {
    const icao =
      aircraft.icao24 ||
      aircraft[0];

    if (!icao) {
      continue;
    }

    const longitude =
      Number(
        aircraft.longitude ??
        aircraft[5]
      );

    const latitude =
      Number(
        aircraft.latitude ??
        aircraft[6]
      );

    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude)
    ) {
      continue;
    }

    const altitude =
      Number(
        aircraft.altitude ??
        aircraft.baroAltitude ??
        aircraft[7] ??
        1000
      );

    const velocity =
      Number(
        aircraft.velocity ??
        aircraft[9] ??
        0
      );

    const heading =
      Number(
        aircraft.heading ??
        aircraft[10] ??
        0
      );

    const callsign =
      String(
        aircraft.callsign ??
        aircraft[1] ??
        icao
      ).trim();

    const country =
      aircraft.country ??
      aircraft[2] ??
      "";

    const existing =
      existingEntities.get(icao);

    /*
     * Store a fresh live snapshot on the entity.
     */
    const motion = {
      latitude,
      longitude,
      altitude: Math.max(
        50,
        Number.isFinite(altitude)
          ? altitude
          : 1000
      ),
      velocity,
      heading,
      updatedAt: now
    };

    if (existing) {
      existing.__worldviewAircraft =
        motion;

      existing.properties =
        new Cesium.PropertyBag({
          type: "aircraft",
          title: callsign,
          icao24: icao,
          country,
          latitude,
          longitude,
          altitude,
          velocity,
          heading
        });

      continue;
    }

    /*
     * Dynamic position.
     *
     * Cesium asks this function for the current
     * position every frame.
     */
    const position =
      new Cesium.CallbackPositionProperty(
        (time, result) => {
          const current =
            existingEntity.__worldviewAircraft;

          if (!current) {
            return Cesium.Cartesian3.fromDegrees(
              longitude,
              latitude,
              altitude,
              Cesium.Ellipsoid.WGS84,
              result
            );
          }

          const currentElapsed =
            (Date.now() -
              current.updatedAt) /
            1000;

          const projected =
            extrapolateAircraft(
              current,
              currentElapsed
            );

          if (!projected) {
            return Cesium.Cartesian3.fromDegrees(
              current.longitude,
              current.latitude,
              current.altitude,
              Cesium.Ellipsoid.WGS84,
              result
            );
          }

          return Cesium.Cartesian3.fromDegrees(
            projected.longitude,
            projected.latitude,
            current.altitude,
            Cesium.Ellipsoid.WGS84,
            result
          );
        },
        false
      );

    let existingEntity;

    existingEntity =
      viewer.entities.add({
        position,

        point: {
          pixelSize: 5,

          color:
            Cesium.Color.CYAN
        },

        label: {
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
              6_000_000
            )
        },

        properties:
          new Cesium.PropertyBag({
            type: "aircraft",
            title: callsign,
            icao24: icao,
            country,
            latitude,
            longitude,
            altitude,
            velocity,
            heading
          })
      });

    existingEntity.__worldviewAircraft =
      motion;

    existingEntities.set(
      icao,
      existingEntity
    );
  }

  return existingEntities;
}

export function removeMissingAircraft(
  viewer,
  entities,
  activeIds
) {
  if (!viewer || viewer.isDestroyed?.()) {
    return;
  }

  for (
    const [icao, entity] of entities
  ) {
    if (!activeIds.has(icao)) {
      viewer.entities.remove(entity);
      entities.delete(icao);
    }
  }
}
