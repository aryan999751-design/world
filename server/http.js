export async function jsonFetch(url, opts={}){
  const headers = {
    "user-agent":"WorldView-Godseye/2.0",
    "accept":"application/json",
    ...(opts.headers||{})
  };
  const res = await fetch(url,{...opts,headers});
  if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
