import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * CSS 令牌引用完整性检查。
 *
 * 背景（真实事故）：表格样式里写了 `var(--bg-surface-elevated, #f1f5f9)`，
 * 但本项目从未定义过 `--bg-surface-elevated`（只有 `--bg-elevated`）。
 * `var()` 遇到未定义变量会**静默**退回兜底值，于是：
 *   - 浅色：表头 #f1f5f9，勉强能看；
 *   - 深色：--text-primary 是 #e8e8e8 近白，落在 #f1f5f9 近白底上，
 *     对比度约 1.1:1 —— 表头文字彻底消失。
 * 而构建、类型检查、原有单测全都照过，没人发现。
 *
 * 该 bug 的通用形态是「CSS 引用了一个谁也不写的变量」。本测试把这类问题
 * 变成编译期必然暴露的失败：任何一个 `var(--token)` 都必须在
 * theme-*.css / tokens.css 里有定义，或在 TS 里通过 setProperty 写入。
 */
const SRC_DIR = path.resolve(__dirname, "..");

/** 变量可能由 JS 在运行时写入（主题切换、用户偏好）。 */
function tokensWrittenByRuntime(): Set<string> {
  const names = new Set<string>();
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(SRC_DIR);

  for (const file of files) {
    const code = fs.readFileSync(file, "utf8");
    // setProperty("--x", ...) 与 setProperty(`--x-${id}`, ...)
    for (const m of code.matchAll(/setProperty\(\s*[`"'](--[a-z0-9-]+)/g)) {
      names.add(m[1]);
    }
    // 模板前缀形式：`--preview-font-${id}` 覆盖 PREVIEW_ELEMENTS 的全部 id
    for (const m of code.matchAll(/setProperty\(\s*`(--[a-z0-9-]+)-\$\{/g)) {
      for (const id of [
        "body",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "code",
        "quote",
        "table",
        "math",
      ]) {
        names.add(`${m[1]}-${id}`);
      }
    }
    // CSS 里也可能声明令牌（我们只扫 css，这里兜住 JS 内联 style 字符串）
    for (const m of code.matchAll(/(--[a-z0-9-]+)\s*:/g)) names.add(m[1]);
  }
  return names;
}

function allCssFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full);
      } else if (entry.name.endsWith(".css")) {
        files.push(full);
      }
    }
  };
  walk(SRC_DIR);
  return files;
}

describe("CSS custom properties are always defined", () => {
  it("never references a token that nothing declares or writes", () => {
    const cssFiles = allCssFiles();
    const runtime = tokensWrittenByRuntime();

    const declared = new Set<string>(runtime);
    for (const file of cssFiles) {
      const css = fs.readFileSync(file, "utf8");
      // 声明：`--token:` 出现在规则块里（排除 var() 内部的自定义属性回退）
      for (const m of css.matchAll(/(^|[;{(\s])(--[a-z0-9-]+)\s*:/g)) {
        declared.add(m[2]);
      }
    }

    const missing: string[] = [];
    for (const file of cssFiles) {
      const css = fs.readFileSync(file, "utf8");
      for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
        const name = m[1];
        if (!declared.has(name)) {
          missing.push(`${path.relative(SRC_DIR, file)}: ${name}`);
        }
      }
    }

    expect(
      [...new Set(missing)],
      `these CSS variables are referenced but never defined (var() silently falls back, which breaks theming):\n${[
        ...new Set(missing),
      ].join("\n")}`,
    ).toEqual([]);
  });
});
