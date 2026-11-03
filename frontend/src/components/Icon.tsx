interface Props {
  name: string;
  className?: string;
  filled?: boolean;
}

// Two elements: Tailwind's size classes live in a CSS layer, so they lose to the icon
// font's unlayered font-size. The outer span takes the classes and the inner one inherits.
export function Icon({ name, className = "", filled = false }: Props) {
  return (
    <span aria-hidden="true" className={`inline-flex ${className}`}>
      <span
        className="material-symbols-outlined"
        style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
      >
        {name}
      </span>
    </span>
  );
}
