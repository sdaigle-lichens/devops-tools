import { useEffect, useState } from "react";

export type ColorMode = "light" | "dark";

function currentMode(): ColorMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * The app's resolved theme, tracked as it changes.
 *
 * React Flow does NOT inherit the surrounding theme — it takes a `colorMode` prop, and left unset
 * it renders its light palette on top of a dark app, which mostly shows up as invisible Controls
 * icons. The class on <html> is set before first paint by public/theme-bootstrap.js and toggled by
 * the theme control afterwards, so a MutationObserver on that attribute is the source of truth.
 */
export function useColorMode(): ColorMode {
  const [mode, setMode] = useState<ColorMode>(currentMode);

  useEffect(() => {
    const observer = new MutationObserver(() => setMode(currentMode()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return mode;
}

/** Flip between light and dark, persisting the choice the bootstrap script reads on next launch. */
export function toggleColorMode(): void {
  const root = document.documentElement;
  const next: ColorMode = root.classList.contains("dark") ? "light" : "dark";
  root.classList.remove("light", "dark");
  root.classList.add(next);
  root.setAttribute("data-theme", next);
  root.style.colorScheme = next;
  try {
    window.localStorage.setItem("theme", next);
  } catch {
    // Private-mode or a locked-down profile. The theme still applies for this session.
  }
}
