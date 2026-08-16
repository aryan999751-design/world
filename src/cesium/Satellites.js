import * as Cesium from "cesium";
export function addSatelliteRows(v,rows){
  for(const r of rows||[]){
    const e=v.entities.add({
      position:Cesium.Cartesian3.fromDegrees(r.lon,r.lat,r.height),
      point:{pixelSize:5,color:Cesium.Color.YELLOW,outlineColor:Cesium.Color.WHITE,outlineWidth:1},
      label:{text:r.name||String(r.norad||""),font:"10px monospace",fillColor:Cesium.Color.WHITE,showBackground:true,backgroundColor:Cesium.Color.BLACK.withAlpha(.55),pixelOffset:new Cesium.Cartesian2(8,0),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,7e6)}
    });
    e.__wv={type:"satellite",...r};
  }
}
