import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Without this, tailwind-merge reads a size class such as text-label-sm as a color and
// drops the real color class next to it. The same goes for the pattern classes in index.css,
// which would otherwise be dropped next to a bg-* color.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "bg-image": [{ bg: ["pattern", "pattern-panel"] }],
      "font-size": [
        {
          text: [
            "headline-xl",
            "headline-md",
            "headline-sm",
            "body-lg",
            "body-md",
            "body-sm",
            "label-md",
            "label-sm",
            "code-sm",
          ],
        },
      ],
    },
  },
});

/** The soft shadow under cards and the header, so neighbouring blocks read as separate. */
export const CARD_SHADOW = "shadow-[0_10px_24px_-12px_rgba(70,50,30,0.28)] dark:shadow-[0_10px_24px_-10px_rgba(0,0,0,0.7)]";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
