import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 在开发时通过固定端口加载前端，故端口不能随机。
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
