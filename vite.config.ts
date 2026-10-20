import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/web" },
  server: {
    port: 5399,
    proxy: {
      "/api": "http://localhost:5310",
      "/auth": "http://localhost:5310",
    },
  },
});
