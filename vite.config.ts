import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 在开发时通过固定端口加载前端，故端口不能随机。
// TAURI_DEV_HOST 用于从真机/局域网访问开发服务器时指定可绑定的地址。
const host = process.env.TAURI_DEV_HOST;

// 「关于」页要显示版本号。构建期注入，避免运行时再发一次 IPC。
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // src-tauri 下的 Rust 构建产物有数 GB、上万文件；
      // 不排除的话 Vite 会持续监听并触发无意义的重载。
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
