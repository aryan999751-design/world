import { jsonFetch } from "./http.js";
export async function geocode(q){
 return jsonFetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&q=${encodeURIComponent(q)}`,{
  headers:{"accept-language":"en","user-agent":"WorldView-Godseye/2.0"}
 });
}
