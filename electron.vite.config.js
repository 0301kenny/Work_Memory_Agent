import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: "electron/main.cjs"
      }
    }
  },
  preload: {
    build: {
      lib: {
        entry: "electron/preload.cjs"
      }
    }
  },
  renderer: {
    root: ".",
    build: {
      rollupOptions: {
        input: "index.html"
      }
    },
    plugins: [react()]
  }
});
