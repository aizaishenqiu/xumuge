/**
 * Re-download Poly Haven CC0 office props (1k glTF).
 * Usage: node scripts/download-office-assets.mjs
 * License policy: CC0 / CC BY only — never SA / NC / paid / Editorial.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const base = path.join(root, "public", "office-assets", "polyhaven");
const UA = { "User-Agent": "FouDesktop/0.1" };

const IDS = [
  "metal_office_desk",
  "modern_arm_chair_01",
  "desk_lamp_arm_01",
  "classic_laptop",
  "potted_plant_01",
  "potted_plant_02",
  "potted_plant_04",
  "Sofa_01",
  "sofa_02",
  "modern_coffee_table_01",
  "modern_wooden_cabinet",
  "wooden_bookshelf_worn",
  "CoffeeCart_01",
  "wall_clock",
  "projector_screen",
  "Shelf_01",
];

async function getJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function dl(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log("skip", dest);
    return;
  }
  console.log("get", url);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  fs.mkdirSync(base, { recursive: true });
  for (const aid of IDS) {
    const dest = path.join(base, aid);
    fs.mkdirSync(dest, { recursive: true });
    const files = await getJson(`https://api.polyhaven.com/files/${aid}`);
    const g = files.gltf["1k"].gltf;
    const name = g.url.split("/").pop();
    await dl(g.url, path.join(dest, name));
    for (const [rel, meta] of Object.entries(g.include || {})) {
      await dl(meta.url, path.join(dest, rel));
    }
    fs.writeFileSync(
      path.join(dest, "entry.json"),
      JSON.stringify(
        {
          id: aid,
          gltf: name,
          license: "CC0",
          source: `https://polyhaven.com/a/${aid}`,
        },
        null,
        2,
      ),
    );
    console.log("done", aid);
  }
  console.log("ALL OK — see public/office-assets/ATTRIBUTION.md");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
