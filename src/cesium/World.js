import * as Cesium from "cesium";
export function clear(v){v.entities.removeAll();}
export function addEarthquakes(v,fc){
 for(const f of (fc?.features||[])){
  const [lon,lat,depth=0]=f.geometry.coordinates; const mag=Number(f.properties.mag||0);
  v.entities.add({position:Cesium.Cartesian3.fromDegrees(lon,lat,0),point:{pixelSize:Math.max(5,Math.min(24,mag*4)),color:Cesium.Color.ORANGERED.withAlpha(.95),outlineColor:Cesium.Color.WHITE.withAlpha(.5),outlineWidth:1},properties:new Cesium.PropertyBag({type:"earthquake",title:f.properties.place||"Earthquake",magnitude:mag,depth,latitude:lat,longitude:lon,time:f.properties.time})});
 }
}
export function addFlights(v,data){
 for(const s of (data?.states||[])){
   if(!Number.isFinite(s[5])||!Number.isFinite(s[6]))continue;
   v.entities.add({position:Cesium.Cartesian3.fromDegrees(s[5],s[6],Math.max(50,(s[7]||0))),point:{pixelSize:3.5,color:Cesium.Color.CYAN},properties:new Cesium.PropertyBag({type:"aircraft",title:(s[1]||s[0]||"").trim(),icao24:s[0],country:s[2],longitude:s[5],latitude:s[6],altitude:s[7],velocity:s[9]})});
 }
}
