import { Moon, Sun } from "lucide-react";
import { toggleColorMode, useColorMode } from "../utils/use-color-mode";

/** Fixed to the bottom-left, out of the way of React Flow's own controls in the other corner. */
export function ThemeToggle() {
  const mode = useColorMode();
  return (
    <button
      type="button"
      onClick={toggleColorMode}
      aria-label={
        mode === "dark" ? "Switch to light theme" : "Switch to dark theme"
      }
      className="fixed bottom-4 left-4 z-50 rounded-full border border-(--line) bg-(--surface) p-2 text-(--ink-2) shadow-sm transition hover:text-(--ink)"
    >
      {mode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
