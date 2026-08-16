const store=new Map();
export function put(id,v){store.set(id,{savedAt:new Date().toISOString(),value:v});return store.get(id)}
export function get(id){return store.get(id)?.value||null}
