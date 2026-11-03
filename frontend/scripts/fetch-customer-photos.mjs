// Picks a portrait for each demo customer and writes public/avatars/manifest.json.
//
// Usage, from frontend/:  node scripts/fetch-customer-photos.mjs
// Needs UNSPLASH_ACCESS_KEY in the environment or in ../.env.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { accessKey, RateLimited, search, use } from "./unsplash.mjs";

const MANIFEST = new URL("../public/avatars/manifest.json", import.meta.url);

// The customers are fictional seed personas, so each is given a look here. Change a query to
// change a portrait; one search serves every customer that shares it.
const PORTRAITS = {
  "CUS-1001": "adult woman headshot",
  "CUS-1002": "smiling man portrait",
  "CUS-1003": "adult woman headshot",
  "CUS-1004": "smiling man portrait",
  "CUS-1005": "adult woman headshot",
  "CUS-1006": "smiling man portrait",
  "CUS-1007": "adult woman headshot",
  "CUS-1008": "smiling man portrait",
  // Deniz is used for any gender in Turkish, so this persona gets a portrait that does not show one.
  "CUS-1009": "person portrait silhouette",
  "CUS-1010": "adult woman headshot",
};

// Portraits that came up but did not suit an avatar, found by looking at the results.
const REJECTED = [
  "photo-1685557869056-4e34c0a6368f", // a child, not an adult customer
  "photo-1635512923599-8ac0d3f8873e", // a silhouette with no face to crop
  "photo-1635256517359-25c63fcc2cb7", // a child, not an adult customer
];

const key = accessKey();
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const used = new Set(Object.values(manifest).map((photo) => photo.url.split("?")[0]));
const searches = new Map();

try {
  for (const [customerId, query] of Object.entries(PORTRAITS)) {
    if (manifest[customerId]) continue;
    if (!searches.has(query)) searches.set(query, await search(query, key, 30));
    const photo = searches
      .get(query)
      .find(
        (result) =>
          !used.has(result.urls.raw.split("?")[0]) &&
          !REJECTED.some((id) => result.urls.raw.includes(id)),
      );
    if (!photo) {
      console.log(`${customerId}: no free portrait left for "${query}"`);
      continue;
    }
    used.add(photo.urls.raw.split("?")[0]);
    // facearea crops around the detected face, so every avatar is framed alike.
    manifest[customerId] = await use(
      photo,
      key,
      "w=200&h=200&fit=facearea&facepad=2.5&auto=format&q=75",
    );
    console.log(`${customerId}: ${manifest[customerId].author}`);
  }
} catch (error) {
  if (!(error instanceof RateLimited)) throw error;
  console.log("Rate limit reached. Run again in an hour; picked portraits are kept.");
} finally {
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${Object.keys(manifest).length} of ${Object.keys(PORTRAITS).length} customers have a portrait.`);
}
