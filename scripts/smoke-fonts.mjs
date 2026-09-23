#!/usr/bin/env node
/**
 * 真实浏览器检查：编辑器字体入口是「图标按钮 + 点击弹下拉」，且下拉里的
 * 字体项各自用对应字体渲染。
 *
 * 为什么必须查浏览器：单测能证明菜单被渲染，但证明不了
 *   ① 它是**点击后**才出现的（而不是常驻一排）；
 *   ② 位置真的落在按钮下方（portal + fixed 定位，单测里量不到真实坐标）；
 *   ③ 每个中文字体项真的以该字体显示。
 * 这三点都曾出过问题（八个中文项一度全渲染成 system-ui）。
 *
 * 用法：先启动 harness（npx vite --config vite.harness.config.ts），再跑本脚本。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const URL = process.env.HARNESS_URL ?? "http://localhost:5199/harness.html";

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
      /* 缓存里的包可能不完整 */
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
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

/** 取 ### Result 之后的第一个非空行（playwright-cli 的返回格式）。 */
function result(out) {
  const lines = out.split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim() === "### Result");
  if (i < 0) return null;
  const line = lines.slice(i + 1).find((l) => l.trim() !== "");
  return line === undefined ? null : line.trim().replace(/^"|"$/g, "");
}

cli(["open", URL, "--browser", "chromium"]);

// 先选中一段文字：没有选区时字体按钮是禁用的（设计如此），
// 直接点会得到 disabled 的按钮、测不到下拉。
const focusEditor = '() => { const c=document.querySelector(".cm-content"); if(!c) return "no"; c.focus(); return "ok"; }';
let focused = null;
for (let i = 0; i < 25 && focused !== "ok"; i += 1) {
  focused = result(cli(["eval", focusEditor]));
  if (focused !== "ok") await new Promise((r) => setTimeout(r, 300));
}
if (focused !== "ok") {
  console.error("harness 里没有找到 CodeMirror 编辑器。检查 harness 是否在运行。");
  process.exit(1);
}
cli(["press", "Control+a"]);

// 等编辑器把选区状态回报给 React（按钮随之启用）。
const findBtn =
  '() => { const b=[...document.querySelectorAll("button")].find(x => x.getAttribute("aria-label")==="字体");' +
  ' if(!b) return "no"; if(b.disabled) return "disabled"; return "yes"; }';

let found = null;
for (let i = 0; i < 25 && found !== "yes"; i += 1) {
  found = result(cli(["eval", findBtn]));
  if (found !== "yes") await new Promise((r) => setTimeout(r, 300));
}

if (found === "disabled") {
  console.error("字体按钮处于禁用态：选区没有生效，检查 smoke 脚本的先选中步骤。");
  process.exit(1);
}
if (found !== "yes") {
  console.error('编辑器里找不到 aria-label="字体" 的按钮。检查 harness 是否在运行。');
  process.exit(1);
}

const failures = [];

// ① 点击前：不应有菜单，也不应有常驻的字体按钮。
const before =
  '() => { const menus=document.querySelectorAll("[role=menu]").length;' +
  ' const fontBtns=[...document.querySelectorAll("button")].filter(b => ["宋体","黑体","楷体","仿宋"].includes(b.getAttribute("aria-label"))).length;' +
  ' return menus + "/" + fontBtns; }';
const beforeVal = result(cli(["eval", before]));
if (beforeVal !== "0/0") {
  failures.push(`点击前就存在菜单或字体按钮（menu/fontButtons=${beforeVal}）`);
}

// ② 点击后：应出现菜单，且菜单在按钮下方。
const clickAndMeasure =
  '() => {' +
  ' const b=[...document.querySelectorAll("button")].find(x => x.getAttribute("aria-label")==="字体");' +
  ' b.click();' +
  ' return "clicked"; }';
cli(["eval", clickAndMeasure]);
await new Promise((r) => setTimeout(r, 400));

const after =
  '() => {' +
  ' const b=[...document.querySelectorAll("button")].find(x => x.getAttribute("aria-label")==="字体");' +
  ' const m=document.querySelector("[role=menu]");' +
  ' if(!m) return "NOMENU";' +
  ' const rb=b.getBoundingClientRect(); const rm=m.getBoundingClientRect();' +
  ' const items=[...m.querySelectorAll("[role=menuitem]")].map(i => {' +
  '   const l=i.querySelector(".ui-menu__label");' +
  '   return l.textContent.trim() + "|" + getComputedStyle(l).fontFamily.split(",")[0];' +
  ' });' +
  ' const expanded=b.getAttribute("aria-expanded");' +
  ' return "expanded=" + expanded + " below=" + (rm.top >= rb.bottom - 2) + " inside=" + (rm.width>0 && rm.height>0)' +
  '   + " :: " + items.join("; "); }';

const afterVal = result(cli(["eval", after]));
if (!afterVal || afterVal === "NOMENU") {
  failures.push("点击后菜单没有出现");
} else {
  console.log("真实浏览器下拉测量：\n" + afterVal);

  if (!/expanded=true/.test(afterVal)) failures.push("按钮未标记 aria-expanded=true");
  if (!/below=true/.test(afterVal)) failures.push("下拉没有出现在按钮下方");
  if (!/inside=true/.test(afterVal)) failures.push("下拉尺寸为零（不可见）");

  // ③ 每个中文字体项必须用各自的字体渲染。
  const itemsPart = afterVal.split(" :: ")[1] ?? "";
  const items = itemsPart
    .split("; ")
    .map((s) => s.split("|"))
    .filter((p) => p.length === 2);

  const cjk = items.filter(([label]) => ["黑体", "宋体", "楷体", "仿宋", "雅黑"].includes(label));
  if (cjk.length < 5) {
    failures.push(`下拉里的中文字体项不足（只找到 ${cjk.length} 项）`);
  }
  for (const [label, font] of cjk) {
    if (/system-ui|-apple-system|Segoe UI/.test(font)) {
      failures.push(`「${label}」被系统/西文字体接管（${font}）`);
    }
  }
  const rendered = cjk.map(([, f]) => f);
  if (new Set(rendered).size !== rendered.length) {
    failures.push(`中文字体项渲染重复，看不出差别：${rendered.join(", ")}`);
  }

  // 西文项也必须用**它自己**的字体，不能用当前默认设置 ——
  // 否则 Times 与等宽会都显示成同一个字体（实测踩过）。
  const latin = items.filter(([label]) => ["Times", "等宽"].includes(label));
  for (const [label, font] of latin) {
    if (/system-ui|-apple-system|Segoe UI/.test(font)) {
      failures.push(`西文项「${label}」用的是系统默认字体而非自身字形（${font}）`);
    }
  }
  const latinRendered = latin.map(([, f]) => f);
  if (new Set(latinRendered).size !== latinRendered.length) {
    failures.push(`西文项渲染重复，看不出差别：${latinRendered.join(", ")}`);
  }
}

if (failures.length > 0) {
  console.error("\n失败：");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("\n通过：字体入口是点击弹出的下拉，位于按钮下方，且各字体项用各自字体渲染。");
