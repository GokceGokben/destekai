import { cn } from "@/lib/utils";

/** Both files have a transparent background. The dark one has its navy lifted to a light blue,
 * so "Destek" stays readable on dark surfaces; the theme class picks which one shows. */
export function Logo({ className }: { className?: string }) {
  const size = cn("h-11 w-auto shrink-0 object-contain", className);
  return (
    <>
      <img src="/logo-wide.png" alt="DestekAI" className={cn(size, "dark:hidden")} />
      <img src="/logo-wide-dark.png" alt="DestekAI" className={cn(size, "hidden dark:block")} />
    </>
  );
}
