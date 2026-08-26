import type { DevopsToolsApi } from "../shared/ipc.js";

declare global {
  interface Window {
    devopsTools: DevopsToolsApi;
  }
}

export {};
