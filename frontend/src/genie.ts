// The macOS "genie" effect for the desktop assistant window: it pours into its launcher button
// when it closes and back out when it opens.
//
// CSS can only scale an element as a whole, and the genie squeezes every row by a different
// amount, so the window is redrawn from a snapshot on a canvas in thin horizontal strips. Each
// frame, a funnel runs from the window's top edge down to the button: its sides bend in with a
// smooth S-curve, and each strip is drawn as wide as the funnel at its height. The first part
// of the animation pinches the funnel, the second slides the window down it.
//
// A snapshot takes most of a second with the fonts embedded, too slow to take on click. So one
// is kept ready: retaken shortly after the chat changes, and still valid while the window is
// closed, because nothing changes it then.

import { createContext, domToCanvas, type Context } from "modern-screenshot";
import { useCallback, useEffect, useRef, useState } from "react";

const DURATION_MS = 600;
const STRIP_PX = 2;
/** The funnel narrows to its neck this far down the way to the button. */
const NECK_START = 0.92;
/** Half the width of the neck, where the funnel stops narrowing quickly. */
const NECK_PX = 12;
/** Half the width of the tip at the button; the neck tapers to it. */
const MOUTH_PX = 1;
/** How long the chat must stay unchanged before a new snapshot is taken. */
const SETTLE_MS = 400;

const contexts = new WeakMap<Element, Promise<Context<HTMLElement>>>();
let queue: Promise<unknown> = Promise.resolve();

/** Snapshots run one at a time, reusing one context per element so fonts are fetched once. */
function snapshot(node: HTMLElement): Promise<HTMLCanvasElement | null> {
  let context = contexts.get(node);
  if (!context) {
    context = createContext(node, {
      scale: window.devicePixelRatio,
      workerNumber: 0,
      // Only Safari and Firefox need a pause before drawing, and the default is 100ms.
      drawImageInterval: 0,
      // Without this, the message list would be captured scrolled to the top.
      features: { restoreScrollPosition: true },
    });
    contexts.set(node, context);
  }
  const ready = context;
  const image = queue.then(() => ready.then((c) => domToCanvas(c))).catch(() => null);
  queue = image;
  return image;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (value: number) => value * value * (3 - 2 * value);
const easeIn = (value: number) => value * value * value;

/** Plays the effect over the page. "in" goes from the window into the button, "out" back.
 * `onCovered` runs once the canvas shows the window, so the real one can be hidden under it. */
async function play(
  image: HTMLCanvasElement,
  from: DOMRect,
  button: DOMRect,
  direction: "in" | "out",
  signal: AbortSignal,
  onCovered: () => void,
): Promise<void> {
  const mouthX = button.left + button.width / 2;
  const mouthY = button.top + button.height / 2;
  const span = mouthY - from.top;
  const scale = image.width / from.width;

  const canvas = document.createElement("canvas");
  const ratio = window.devicePixelRatio;
  // The viewport without its scrollbars: 100vw and innerWidth include the vertical scrollbar,
  // so a canvas that wide overflows the page and brings up scrollbars of its own.
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.cssText = `position:fixed;top:0;left:0;width:${width}px;height:${height}px;z-index:50;pointer-events:none`;
  document.body.append(canvas);
  const context = canvas.getContext("2d")!;
  context.scale(ratio, ratio);

  // progress 0 is the open window, 1 is fully inside the button.
  function draw(progress: number) {
    const pinch = smoothstep(clamp(progress / 0.5));
    const slide = easeIn(clamp((progress - 0.25) / 0.75)) * span;
    context.clearRect(0, 0, width, height);
    context.globalAlpha = 1 - clamp((progress - 0.85) / 0.15);
    // At rest, one sharp copy: strips overlap by half a pixel and would blur it slightly.
    if (pinch === 0 && slide === 0) {
      context.drawImage(image, from.left, from.top, from.width, from.height);
      return;
    }
    for (let row = 0; row < from.height; row += STRIP_PX) {
      const y = from.top + row + slide;
      if (y >= mouthY) break;
      const depth = (y - from.top) / span;
      const bend = smoothstep(clamp(depth / NECK_START)) * pinch;
      const half = NECK_PX + (MOUTH_PX - NECK_PX) * clamp((depth - NECK_START) / (1 - NECK_START));
      const left = from.left + (mouthX - half - from.left) * bend;
      const right = from.right + (mouthX + half - from.right) * bend;
      // The extra half pixel hides seams between strips.
      context.drawImage(image, 0, row * scale, image.width, STRIP_PX * scale, left, y, right - left, STRIP_PX + 0.5);
    }
  }

  draw(direction === "in" ? 0 : 1);
  onCovered();

  await new Promise<void>((resolve) => {
    const start = performance.now();
    function frame(now: number) {
      if (signal.aborted) return resolve();
      const elapsed = clamp((now - start) / DURATION_MS);
      draw(direction === "in" ? elapsed : 1 - elapsed);
      if (elapsed < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });

  if (signal.aborted || direction === "in") canvas.remove();
  // An opened window is swapped in at once, not faded: the snapshot's text can wrap a pixel
  // differently, and blending the two looked like the layout settling. Two frames first, so
  // the window has rendered before the canvas goes.
  else requestAnimationFrame(() => requestAnimationFrame(() => canvas.remove()));
}

/**
 * Animates the window between open and closed. `content` lists the values the window's
 * content depends on, always the same number of them; when one changes, a new snapshot is
 * scheduled. Returns refs for the window,
 * whose first child is what gets captured, and its launcher button, and whether the window
 * itself should be visible: it is hidden while the animation plays in its place.
 */
export function useGenie(open: boolean, enabled: boolean, content: readonly unknown[]) {
  const windowRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(open);
  const wasOpen = useRef(open);
  const latest = useRef<{ image: Promise<HTMLCanvasElement | null>; fresh: boolean } | null>(null);
  // The theme is a class on <html>, outside React; a snapshot from the old theme would open a
  // light window in dark mode, so a theme change counts as a content change.
  const [theme, setTheme] = useState(() => document.documentElement.className);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(root.className));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const capture = useCallback(() => {
    const node = windowRef.current?.firstElementChild;
    const image = node instanceof HTMLElement ? snapshot(node) : Promise.resolve(null);
    latest.current = { image, fresh: true };
    return image;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (latest.current) latest.current.fresh = false;
    const timer = setTimeout(capture, SETTLE_MS);
    return () => clearTimeout(timer);
    // Spread, so a new array holding the same values does not reschedule the snapshot.
  }, [enabled, capture, theme, ...content]);

  useEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    const node = windowRef.current?.firstElementChild;
    const launcher = launcherRef.current;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!enabled || still || !(node instanceof HTMLElement) || !launcher) {
      setShown(open);
      return;
    }
    // A toggle mid-animation aborts it, and the new one starts from the same snapshot.
    const controller = new AbortController();
    const image = latest.current?.fresh ? latest.current.image : capture();
    image.then(async (canvas) => {
      if (controller.signal.aborted) return;
      if (canvas) {
        const from = node.getBoundingClientRect();
        const button = launcher.getBoundingClientRect();
        await play(canvas, from, button, open ? "out" : "in", controller.signal, () => {
          if (!open) setShown(false);
        });
      }
      if (!controller.signal.aborted) setShown(open);
    });
    return () => controller.abort();
  }, [open, enabled, capture]);

  return { windowRef, launcherRef, shown };
}
