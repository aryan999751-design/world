export function startAIS({apiKey,onMessage}) {
  if (!apiKey || typeof globalThis.WebSocket !== "function") return null;
  const socket = new globalThis.WebSocket("wss://stream.aisstream.io/v0/stream");
  socket.onopen = () => socket.send(JSON.stringify({
    APIKey: apiKey,
    BoundingBoxes: [[[-90,-180],[90,180]]]
  }));
  socket.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch {} };
  return socket;
}
