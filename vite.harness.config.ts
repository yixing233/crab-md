import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// 仅用于开发期视觉校验（harness.html），不参与正式构建。
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: 5199,
    strictPort: true,
    watch: {
      // 编辑工具的原子写会先建 `.文件名.<pid>.<uuid>.tmpdir/`；
      // chokidar 去 watch 那个临时目录会撞 Windows 文件锁 EBUSY，整个 server 崩掉。
      // src-tauri 下的 Rust 构建产物同理（rebuild 时 exe 被占用）。
      ignored: ["**/*.tmpdir/**", "**/src-tauri/**", "**/output/**", "**/.playwright-cli/**"],
    },
  },
});
