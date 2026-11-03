// Shared by the photo scripts. Unsplash's API terms require showing photos from their own
// URLs, crediting the photographer and reporting each use through download_location, so the
// scripts store only URLs and credits. A demo key allows 50 requests an hour.

import { existsSync, readFileSync } from "node:fs";

export class RateLimited extends Error {}

export function accessKey() {
  if (process.env.UNSPLASH_ACCESS_KEY) return process.env.UNSPLASH_ACCESS_KEY;
  const envFile = new URL("../../.env", import.meta.url);
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, "utf8")
      .split(/\r?\n/)
      .find((row) => row.startsWith("UNSPLASH_ACCESS_KEY="));
    const value = line?.slice("UNSPLASH_ACCESS_KEY=".length).trim();
    if (value) return value;
  }
  throw new Error("UNSPLASH_ACCESS_KEY is not set");
}

export async function api(path, key) {
  const response = await fetch(`https://api.unsplash.com${path}`, {
    headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
  });
  if (response.status === 403 || response.status === 429) throw new RateLimited();
  if (!response.ok) throw new Error(`Unsplash returned ${response.status} for ${path}`);
  return response.json();
}

/** Free photos only: Unsplash+ photos need a paid licence. */
export async function search(query, key, perPage = 10) {
  const params = new URLSearchParams({
    query,
    per_page: String(perPage),
    orientation: "squarish",
    content_filter: "high",
  });
  const { results } = await api(`/search/photos?${params}`, key);
  return results.filter((result) => !result.premium && !result.plus);
}

/** Reports the use, as the API terms require, and returns what the manifest stores. */
export async function use(photo, key, imgixParams) {
  const downloadLocation = new URL(photo.links.download_location);
  await api(downloadLocation.pathname + downloadLocation.search, key);
  const utm = "utm_source=destekai&utm_medium=referral";
  return {
    url: `${photo.urls.raw}&${imgixParams}`,
    author: photo.user.name,
    author_url: `${photo.user.links.html}?${utm}`,
  };
}
