export function normalizeGeoJSON(fc){
  return { type:"FeatureCollection", features:(fc?.features||[]).map(f=>({
    ...f, properties:{source:f.properties?.source||"user-import",...f.properties}
  })) };
}
