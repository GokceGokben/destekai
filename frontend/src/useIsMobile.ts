import { useEffect, useState } from "react";

const QUERY = "(max-width: 767px)";

/** The Stitch phone screen has its own structure, so CSS breakpoints alone cannot produce it. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia?.(QUERY).matches ?? false);

  useEffect(() => {
    const media = window.matchMedia?.(QUERY);
    if (!media) return;
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return mobile;
}
