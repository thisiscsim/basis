/// <reference types="vite/client" />

import type { BasisApi } from "../../preload";

export {};

declare global {
  interface Window {
    api: BasisApi;
  }
}
