import { Outlet, createRootRoute } from "@tanstack/react-router";
import { ThemeToggle } from "../components/theme-toggle";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="flex h-full flex-col bg-(--bg) text-(--ink)">
      <Outlet />
      <ThemeToggle />
    </div>
  );
}
