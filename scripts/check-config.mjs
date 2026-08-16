import fs from "node:fs";
import path from "node:path";
const required = ["package.json","index.html","vite.config.js","src/main.jsx","server/index.js"];
const missing = required.filter(f=>!fs.existsSync(path.resolve(f)));
if (missing.length) { console.error("Missing:", missing.join(", ")); process.exit(1); }
console.log("WorldView file structure OK.");
