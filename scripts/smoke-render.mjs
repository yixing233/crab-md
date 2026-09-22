#!/usr/bin/env node
/**
 * 真实浏览器冒烟检查：表格与公式确实渲染出来了。
 *
 * 为什么必须有这个脚本（不能只靠 vitest）：
 * KaTeX 插件是 CommonJS 包。vitest 里 import 直接得到函数，浏览器里经 Vite
 * 的 CJS 互操作得到 `{ default: fn }`。曾出现过「vitest 全绿、浏览器预览整块
 * 空白」的事故 —— 事后把 bug 改回去再跑单测，仍然 33 passed。
 * 也就是说这个缺陷只能由真实运行环境发现，单测守不住。
 *
 * 用法：
 *   1) npx vite --config vite.harness.config.ts     （另开一个终端）
 *   2) node scripts/smoke-render.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const URL = process.env.HARNESS_URL ?? "http://localhost:5199/harness.html";

/** 在项目内安装与 npx 缓存里寻找 playwright-cli 的入口脚本。 */
function findCli() {
  const pkgs = [
    join(process.cwd(), "node_modules", "@playwright", "cli", "package.json"),
  ];

  // npx 会把包解到 %LOCALAPPDATA%\npm-cache\_npx\<hash>\node_modules\...
  const npxCache = join(process.env.LOCALAPPDATA ?? join(homedir(), ".npm"), "npm-cache", "_npx");
  if (existsSync(npxCache)) {
    for (const entry of readdirSync(npxCache)) {
      pkgs.push(join(npxCache, entry, "node_modules", "@playwright", "cli", "package.json"));
    }
  }

  for (const pkg of pkgs) {
    if (!existsSync(pkg)) continue;
    try {
      const parsed = JSON.parse(readFileSync(pkg, "utf8"));
      // bin 可能是字符串，也可能是 { 名字: 路径 }。
      const bin = typeof parsed.bin === "string" ? parsed.bin : Object.values(parsed.bin ?? {})[0];
      if (typeof bin === "string") return join(pkg, "..", bin);
    } catch {
      // 缓存里的包可能不完整，跳过继续找。
    }
  }
  return null;
}

const CLI_BIN = findCli();
if (!CLI_BIN) {
  console.error(
    "找不到 playwright-cli。先执行一次以下命令让它进入 npx 缓存：\n" +
      "  npx --yes --package @playwright/cli playwright-cli --version",
  );
  process.exit(1);
}

/**
 * 调用 playwright-cli。
 *
 * 关键：**不能经过 shell**。表达式里的空格会被 shell 拆成多个参数
 * （实测报 "too many arguments: expected 2, received 18"）。
 * 因此直接 spawn node + CLI 脚本，参数数组原样传递。
 */
function cli(args) {
  const r = spawnSync(process.execPath, [CLI_BIN, ...args], { encoding: "utf8" });
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error ? String(r.error) : null };
}

const opened = cli(["open", URL, "--browser", "chromium"]);
if (opened.error) {
  console.error("打开页面失败：" + opened.error);
  process.exit(1);
}

const expr =
  '() => { const o=document.querySelector(".settings-overlay"); if(o) o.style.display="none";' +
  ' const b=document.querySelector(".update-bar"); if(b) b.style.display="none";' +
  ' return JSON.stringify({tables: document.querySelectorAll(".markdown-preview table").length,' +
  ' katex: document.querySelectorAll(".markdown-preview .katex").length,' +
  ' mathml: document.querySelectorAll(".markdown-preview math").length}); }';

const evaluated = cli(["eval", expr]);
if (evaluated.error) {
  console.error("执行 eval 失败：" + evaluated.error);
  process.exit(1);
}

// playwright-cli 的输出形如：
//   ### Result
//   "{\"tables\":1,\"katex\":3,\"mathml\":3}"
// 即「一行被转义的 JSON 字符串」。先取那一行，再反转义一次。
const resultLine = evaluated.out
  .split(/\r?\n/)
  .map((l) => l.trim())
  .find((l) => l.startsWith('"') && l.includes("tables"));

if (!resultLine) {
  console.error("无法从浏览器读取渲染结果。原始输出：\n" + evaluated.out);
  process.exit(1);
}

let counts;
try {
  counts = JSON.parse(JSON.parse(resultLine));
} catch (e) {
  console.error("浏览器返回的内容无法解析：" + resultLine + "\n" + String(e));
  process.exit(1);
}

console.log("真实浏览器渲染结果：", counts);

const failures = [];
if (counts.tables < 1) failures.push("表格未渲染（<table> 数量为 0）");
if (counts.katex < 1) failures.push("公式未渲染（.katex 数量为 0）");
// MathML 缺失意味着屏幕阅读器读不到公式。
if (counts.mathml < 1) failures.push("MathML 缺失（屏幕阅读器无法朗读公式）");

if (failures.length > 0) {
  console.error("\n失败：");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("\n通过：表格、KaTeX 公式、MathML 均已在真实浏览器中渲染。");
