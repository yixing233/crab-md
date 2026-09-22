#!/usr/bin/env node
/**
 * 真实浏览器检查：字体设置的两组选项是否**各自用对应字体**渲染。
 *
 * 为什么必须查浏览器：字体是否真的生效只能看计算样式。单测能证明 style
 * 属性写对了，但证明不了「宋体」两个字真的以宋体显示 —— 而这正是选择列表
 * 的核心价值。实测曾出现六个中文选项全渲染成 system-ui 的缺陷（西文排在
 * 栈首把汉字吃掉了），单测完全看不出来。
 *
 * 用法：先启动 harness（npx vite --config vite.harness.config.ts），再跑本脚本。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const URL = process.env.HARNESS_URL ?? "http://localhost:5199/harness.html";

/** 在项目内安装与 npx 缓存里寻找 playwright-cli 的入口脚本。 */
function findCli() {
  const pkgs = [join(process.cwd(), "node_modules", "@playwright", "cli", "package.json")];
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
  console.error("找不到 playwright-cli。先执行一次：npx --yes --package @playwright/cli playwright-cli --version");
  process.exit(1);
}

/** 不经过 shell：表达式里的空格/引号会被 shell 拆坏。 */
function cli(args) {
  const r = spawnSync(process.execPath, [CLI_BIN, ...args], { encoding: "utf8" });
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error ? String(r.error) : null };
}

cli(["open", URL, "--browser", "chromium"]);

// 点「编辑器」分组后 React 需要一次渲染才挂上字体列表；
// 立刻 eval 会读到空结果（实测拿到 ""）。先轮询等它出现。
const waitExpr =
  '() => { const ov=document.querySelector(".settings-overlay"); if(ov) ov.style.display="";' +
  ' const bar=document.querySelector(".update-bar"); if(bar) bar.style.display="none";' +
  ' for (const s of document.querySelectorAll(".settings-nav__item")) { if (s.textContent.includes("编辑器")) { s.click(); break; } }' +
  ' return document.querySelectorAll(".ui-font-picker").length; }';

let ready = 0;
for (let i = 0; i < 20 && ready < 2; i += 1) {
  const probe = cli(["eval", waitExpr]);
  const m = probe.out.match(/### Result\r?\n(\d+)/);
  ready = m ? Number(m[1]) : 0;
  if (ready < 2) await new Promise((r) => setTimeout(r, 300));
}

if (ready < 2) {
  console.error(`字体列表未渲染出来（只找到 ${ready} 组）。检查 harness 是否在运行。`);
  process.exit(1);
}

const expr =
  '() => { const ov=document.querySelector(".settings-overlay"); if(ov) ov.style.display="";' +
  ' const bar=document.querySelector(".update-bar"); if(bar) bar.style.display="none";' +
  ' for (const s of document.querySelectorAll(".settings-nav__item")) { if (s.textContent.includes("编辑器")) { s.click(); break; } }' +
  ' const out=[];' +
  ' for (const g of document.querySelectorAll(".ui-font-picker")) {' +
  '   const rows=[];' +
  '   for (const n of g.querySelectorAll(".ui-font-picker__name")) {' +
  '     rows.push(n.textContent.trim() + "|" + getComputedStyle(n).fontFamily.split(",")[0]);' +
  '   }' +
  '   out.push(g.getAttribute("aria-label") + "=" + rows.join(";"));' +
  ' }' +
  ' return out.join(" || "); }';

const evaluated = cli(["eval", expr]);
if (evaluated.error) {
  console.error("执行 eval 失败：" + evaluated.error);
  process.exit(1);
}

// playwright-cli 输出形如：### Result\n"中文字体=..." 或 \n中文字体=...
// 视内容而定可能带引号也可能不带，两种都接受。
const line = evaluated.out
  .split(/\r?\n/)
  .map((l) => l.trim())
  .find((l) => l.includes("字体="));

if (!line) {
  console.error("无法读取字体列表渲染结果。原始输出：\n" + evaluated.out);
  process.exit(1);
}

const report = line.replace(/^"|"$/g, "");
console.log("真实浏览器字体列表渲染：\n" + report);

const failures = [];

// 中文组的每个具名选项必须渲染成它自己的字体，而不是全都一样。
for (const part of String(report).split(" || ")) {  const [group, itemsRaw] = part.split("=");
  if (!itemsRaw) continue;
  const items = itemsRaw.split(";").map((s) => s.split("|"));
  if (group === "中文字体") {
    const rendered = items.map(([, font]) => font);
    const named = items.filter(([label]) => label !== "系统默认");
    // 六个中文选项若全渲染成同一个字体，说明预览栈没让中文字形排第一。
    if (new Set(rendered).size === 1) {
      failures.push(`中文字体组的所有选项渲染成同一字体（${rendered[0]}），看不出差别`);
    }
    for (const [label, font] of named) {
      if (/system-ui|-apple-system|Segoe UI/.test(font)) {
        failures.push(`「${label}」被西文/系统字体接管（${font}）`);
      }
    }
  }
  if (group === "西文字体") {
    const georgia = items.find(([label]) => label === "Georgia");
    if (georgia && !/Georgia/.test(georgia[1])) {
      failures.push(`「Georgia」未用 Georgia 渲染（实际 ${georgia[1]}）`);
    }
  }
}

if (failures.length > 0) {
  console.error("\n失败：");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("\n通过：中文与西文两组选项都各自用对应字体渲染。");
