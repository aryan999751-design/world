import fs from "node:fs/promises";import path from "node:path";import {fileURLToPath} from "node:url";
const __dirname=path.dirname(fileURLToPath(import.meta.url));
export async function getReplay(id="demo"){const p=path.join(__dirname,"replays",`${id}.json`);return JSON.parse(await fs.readFile(p,"utf8"))}
