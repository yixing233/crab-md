/// <reference types="@testing-library/jest-dom/vitest" />

/**
 * Vite 构建期注入的常量（见 vite.config.ts 的 `define`）。
 * 声明在此以便 tsc 认识；单测环境下同样由 vite 配置注入。
 */
declare const __APP_VERSION__: string;
