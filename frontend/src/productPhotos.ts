import { useEffect, useState } from "react";

/** Written by scripts/fetch-product-images.mjs and scripts/fetch-customer-photos.mjs.
 * Unsplash's API terms require showing the photo from its own URL and crediting the
 * photographer, so only the URLs are stored. */
interface ProductPhoto {
  url: string;
  author: string;
  author_url: string;
}

type PhotoManifest = Record<string, ProductPhoto>;

const manifests = new Map<string, Promise<PhotoManifest>>();

function loadManifest(path: string): Promise<PhotoManifest> {
  let manifest = manifests.get(path);
  if (!manifest) {
    manifest = fetch(path)
      .then((response) => (response.ok ? (response.json() as Promise<PhotoManifest>) : {}))
      .catch(() => ({}));
    manifests.set(path, manifest);
  }
  return manifest;
}

function usePhotos(path: string): PhotoManifest {
  const [photos, setPhotos] = useState<PhotoManifest>({});

  useEffect(() => {
    let active = true;
    loadManifest(path).then((loaded) => active && setPhotos(loaded));
    return () => {
      active = false;
    };
  }, [path]);

  return photos;
}

/** Keyed by order_items.image_key. */
export function useProductPhotos(): PhotoManifest {
  return usePhotos("/products/manifest.json");
}

/** Keyed by customer ID. */
export function useCustomerPhotos(): PhotoManifest {
  return usePhotos("/avatars/manifest.json");
}
