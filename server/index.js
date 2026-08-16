import express from "express";
import { getReplay } from "./replay.js";
import { propagate } from "./satellite.js";
import { correlate } from "./correlation.js";
import { put,get } from "./store.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TTLCache } from "./cache.js";
import { geocode } from "./geocode.js";
import { earthquakes, opensky, satellites } from "./adapters.js";
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(); const port=Number(process.env.PORT||10000); const cache=new TTLCache(30000);
app.use(express.json({limit:"3mb"}));
app.get("/api/health",(_q,r)=>r.json({ok:true,phase:2,time:new Date().toISOString()}));
app.get("/api/config",(_q,r)=>r.json({cesiumIonToken:process.env.CESIUM_ION_TOKEN||""}));
app.get("/api/geocode",async(req,res)=>{try{res.json(await geocode(String(req.query.q||"")));}catch(e){res.status(502).json({error:e.message});}});
async function dataRoute(key,fn,res,ms=30000){try{let v=cache.get(key);if(!v){v=await fn();cache.set(key,v,ms)}res.json(v)}catch(e){res.status(502).json({error:e.message})}}
app.get("/api/data/earthquakes",(_q,r)=>dataRoute("eq",earthquakes,r,60000));
app.get("/api/data/flights",(_q,r)=>dataRoute("flights",opensky,r,15000));
app.get("/api/data/satellites", (q,r)=>dataRoute("sat:"+String(q.query.group||"visual"),()=>satellites(String(q.query.group||"visual")),r,360000));
app.get("/api/replay/:id",async(req,res)=>{try{res.json(await getReplay(req.params.id))}catch(e){res.status(404).json({error:e.message})}});
app.get("/api/data/satellite-positions",async(req,res)=>{
 try{
  const group=String(req.query.group||"visual"); const at=Number(req.query.at||Date.now());
  const catalog=await satellites(group);
  const rows=(catalog||[]).map(x=>{const p=propagate(x,at);return p?{name:x.OBJECT_NAME||x.OBJECT_NAME_EN, norad:x.OBJECT_ID, ...p}:null}).filter(Boolean);
  res.json({time:new Date(at).toISOString(),rows});
 }catch(e){res.status(502).json({error:e.message})}
});
app.post("/api/correlate",(req,res)=>{try{res.json(correlate(req.body?.events||[],req.body?.options||{}))}catch(e){res.status(400).json({error:e.message})}});
app.post("/api/workspaces/:id",(req,res)=>{try{res.json(put(req.params.id,req.body||{}))}catch(e){res.status(400).json({error:e.message})}});
app.get("/api/workspaces/:id",(req,res)=>{const x=get(req.params.id);if(!x)return res.status(404).json({error:"not found"});res.json(x)});

app.get("/api/status",(_q,r)=>r.json({streams:{
 earthquakes:{source:"USGS",kind:"live"},
 flights:{source:"OpenSky",kind:"live/rate-limited"},
 satellites:{source:"CelesTrak",kind:"catalog"}
}}));
app.use(express.static(path.join(__dirname,"..","dist"))); app.get("/{*splat}",(_q,r)=>r.sendFile(path.join(__dirname,"..","dist","index.html")));
app.listen(port,()=>console.log(`WorldView Phase 2 on ${port}`));
