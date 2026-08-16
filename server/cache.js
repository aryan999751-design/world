export class TTLCache {
  constructor(defaultMs=30000){ this.defaultMs=defaultMs; this.map=new Map(); }
  get(key){ const x=this.map.get(key); if(!x)return null; if(Date.now()-x.t>x.ms){this.map.delete(key);return null;} return x.v; }
  set(key,v,ms=this.defaultMs){ this.map.set(key,{v,t:Date.now(),ms}); return v; }
  clear(){ this.map.clear(); }
}
