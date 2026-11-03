// Picks one Unsplash photo per product and writes public/products/manifest.json.
//
// Usage, from frontend/:  node scripts/fetch-product-images.mjs
// Needs UNSPLASH_ACCESS_KEY in the environment or in ../.env. The script keeps what it has
// already picked, so it can be run again after a rate limit.
//
// It takes the first acceptable result, which is often wrong for appliances. Several entries
// in the manifest were instead chosen by eye from the top results and must not be overwritten;
// delete a manifest entry to let the script pick that product again.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { accessKey, RateLimited, search, use } from "./unsplash.mjs";

const MANIFEST = new URL("../public/products/manifest.json", import.meta.url);

// Keys match image_key in order-api/internal/seed/seed.sql.
const QUERIES = {
  "smart-watch": "smartwatch",
  "spice-rack": "spice rack",
  blender: "kitchen blender",
  "bluetooth-speaker": "bluetooth speaker",
  "tea-set": "turkish tea glass on saucer",
  "kids-bike": "kids bike",
  "leather-belt": "leather belt",
  "laptop-bag": "laptop bag",
  "wall-clock": "wall clock",
  "vacuum-cleaner": "vacuum cleaner on floor",
  rug: "rug",
  headphones: "wireless headphones",
  "coffee-machine": "coffee machine",
  "winter-jacket": "winter jacket",
  books: "stack of books",
  jeans: "jeans",
  "desk-lamp": "desk lamp",
  "mechanical-keyboard": "mechanical keyboard",
  "food-processor": "stand mixer",
  bedding: "bed linen",
  "office-chair": "office chair",
  "gaming-mouse": "gaming mouse",
  "t-shirt": "white t-shirt",
  "hair-dryer": "blow dryer",
  backpack: "backpack",
  sneakers: "sneakers",
  stylus: "tablet stylus pen",
  "phone-case": "phone case",
  thermos: "thermos flask",
  "sandwich-maker": "sandwich toaster",
  iron: "steam iron",
  raincoat: "yellow raincoat",
  "yoga-mat": "yoga mat",
};

// Photos that matched the query but not the product, found by looking at the results.
// Skipping them lets the next run pick the following result instead of the same one.
const REJECTED = [
  "photo-1668074201943-a142177d7f58", // blender: a 3D kitchen render
  "photo-1773558057627-fed7a42b8520", // hair dryer: an art piece
  "photo-1619252283855-764d00f81c5a", // kids bike: children on a quad bike
  "photo-1724565843291-9cfbdd818ea6", // blender: a dark kitchen
  "photo-1761450154531-2ad32b7d5583", // kids bike: motorcycles in traffic
];

const key = accessKey();
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};

try {
  for (const [imageKey, query] of Object.entries(QUERIES)) {
    if (manifest[imageKey]) continue;
    const results = await search(query, key);
    const photo = results.find((result) => !REJECTED.some((id) => result.urls.raw.includes(id)));
    if (photo) {
      manifest[imageKey] = await use(photo, key, "w=320&h=320&fit=crop&auto=format&q=70");
      console.log(`${imageKey}: ${manifest[imageKey].author}`);
    } else {
      console.log(`${imageKey}: no free photo found`);
    }
  }
} catch (error) {
  if (!(error instanceof RateLimited)) throw error;
  console.log("Rate limit reached. Run again in an hour; picked photos are kept.");
} finally {
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${Object.keys(manifest).length} of ${Object.keys(QUERIES).length} products have a photo.`);
}
