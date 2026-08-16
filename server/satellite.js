import satellite from "satellite.js";
export function propagate(record, atMs=Date.now()) {
  try {
    const satrec = satellite.twoline2satrec(record.TLE_LINE1 || record.tle1, record.TLE_LINE2 || record.tle2);
    const d = satellite.propagate(satrec, new Date(atMs));
    if (!d.position) return null;
    const gmst = satellite.gstime(new Date(atMs));
    const geo = satellite.eciToGeodetic(d.position, gmst);
    return {
      lat: satellite.degreesLat(geo.latitude),
      lon: satellite.degreesLong(geo.longitude),
      height: geo.height * 1000
    };
  } catch {
    return null;
  }
}
