import { useState } from "react";

import { cn } from "@/lib/utils";

import { useProductPhotos } from "../productPhotos";
import type { OrderItem } from "../types";
import { Icon } from "./Icon";

interface Props {
  item: OrderItem;
  /** Sizes the frame; the photo fills it. */
  className?: string;
}

/** Falls back to an icon until the photos are fetched, or when a photo fails to load. */
export function ProductImage({ item, className }: Props) {
  const photos = useProductPhotos();
  const [failed, setFailed] = useState(false);
  const photo = item.image_key ? photos[item.image_key] : undefined;

  if (!photo || failed) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg bg-surface-container text-on-surface-variant",
          className,
        )}
      >
        <Icon name="inventory_2" className="text-[22px]" />
      </div>
    );
  }

  // The frame clips the zoom, so the photo grows inside its own corners.
  return (
    <div className={cn("shrink-0 overflow-hidden rounded-lg bg-surface-container", className)}>
      <img
        src={photo.url}
        alt={item.product_name}
        title={`Fotoğraf: ${photo.author} / Unsplash`}
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-full object-cover transition-transform duration-300 hover:scale-110 motion-reduce:transition-none"
      />
    </div>
  );
}
