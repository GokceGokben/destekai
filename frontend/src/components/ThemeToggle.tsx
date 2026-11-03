import { useTheme } from "../theme";
import { Icon } from "./Icon";

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const label = theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="w-9 h-9 rounded-lg flex items-center justify-center bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
    >
      <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} className="text-[20px]" />
    </button>
  );
}
