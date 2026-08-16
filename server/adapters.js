import { jsonFetch } from "./http.js";
export async function earthquakes(){
 return jsonFetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
}
export async function opensky(env){
 const headers={};
 // OAuth2 token acquisition can be added when credentials exist.
 return jsonFetch("https://opensky-network.org/api/states/all",{headers});
}
export async function satellites(group="visual"){
 return jsonFetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=JSON`);
}
