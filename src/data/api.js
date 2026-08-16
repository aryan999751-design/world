export async function api(url,opts){const r=await fetch(url,opts);if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||`${r.status}`);return r.json();}
export const config=()=>api("/api/config");
export const earthquakes=()=>api("/api/data/earthquakes");
export const flights=()=>api("/api/data/flights");
export const satellites=(g="visual")=>api("/api/data/satellites?group="+encodeURIComponent(g));
export const geocode=q=>api("/api/geocode?q="+encodeURIComponent(q));
