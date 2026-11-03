import { useState } from "react";

import { initials } from "../format";
import { useCustomerPhotos } from "../productPhotos";
import type { Customer } from "../types";

/** Fills its circular, positioned parent with the customer's portrait, or shows initials
 * until the portraits load or when one fails. */
export function CustomerAvatar({ customer }: { customer: Customer }) {
  const photos = useCustomerPhotos();
  const [failed, setFailed] = useState(false);
  const photo = photos[customer.id];

  if (!photo || failed) return <>{initials(customer)}</>;

  return (
    <img
      src={photo.url}
      alt={customer.full_name}
      title={`Fotoğraf: ${photo.author} / Unsplash`}
      onError={() => setFailed(true)}
      className="absolute inset-0 size-full rounded-full object-cover"
    />
  );
}
