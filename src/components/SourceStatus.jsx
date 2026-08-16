import React from "react";
export default function SourceStatus({health}){return <div className="source-panel"><div className="k">SOURCE MATRIX</div>{Object.entries(health||{}).map(([k,v])=><div className="src-row" key={k}><span>{k}</span><b>{v}</b></div>)}</div>}
