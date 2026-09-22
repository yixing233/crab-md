#!/usr/bin/env node
/**
 * 生成 Tauri updater 的 `latest.json` 清单。
 *
 * 为什么要自己生成：`tauri build` 会产出安装包与 `.sig` 签名文件，
 * 但**不会**把它们拼成 updater 需要的清单。清单是客户端判断
 * 「有没有新版本、去哪下、签名是什么」的唯一依据，漏了它更新就不会被发现。
 *
 * 幂等且可重复运行：同一版本重跑只覆盖同名文件。
 *
 * 用法：
 *   node scripts/make-latest-json.mjs --tag v0.1.0 --notes "修复…"
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BUNDLE_DIR = join(ROOT, "src-tauri", "target", "release", "bundle");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = argv[i + 1]?.startsWith("--") ? "" : argv[++i];
      if (out[a.slice(2)] === undefined) out[a.slice(2)] = "";
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// 版本优先取 --tag（去掉前缀 v），回退到 tauri.conf.json。
// 用 tag 而不是 package.json：tag 才是「这次发布的内容」的权威标识。
const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
const rawTag = args.tag ?? `v${conf.version}`;
const version = String(rawTag).replace(/^v/, "");

const repo = args.repo ?? process.env.GITHUB_REPOSITORY ?? "yixing233/crab-md";
const notes = args.notes ?? `crab-md ${version}`;

/** 递归找出所有 .sig 及其对应的安装包。 */
function findSignedArtifacts(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findSignedArtifacts(full));
    } else if (entry.name.endsWith(".sig")) {
      const artifact = full.slice(0, -4);
      if (existsSync(artifact)) found.push({ artifact, sig: full });
    }
  }
  return found;
}

const signed = findSignedArtifacts(BUNDLE_DIR);

if (signed.length === 0) {
  console.error(
    `没有找到任何已签名的安装包（在 ${BUNDLE_DIR} 下）。\n` +
      "请确认 tauri.conf.json 里 bundle.createUpdaterArtifacts 为 true，" +
      "且构建时设置了 TAURI_SIGNING_PRIVATE_KEY。",
  );
  process.exit(1);
}

/**
 * 从文件名判断平台键。
 * Tauri 的键名是固定的几个（windows-x86_64 / linux-x86_64 / darwin-*），
 * 客户端按 `平台-架构` 查表，写错就等于该平台收不到更新。
 */
function platformKeyFor(name) {
  const n = name.toLowerCase();
  if (n.endsWith(".nsis.zip") || n.endsWith(".exe") || n.endsWith(".msi") || n.endsWith(".msi.zip")) {
    return "windows-x86_64";
  }
  if (n.endsWith(".app.tar.gz")) {
    return "darwin-aarch64";
  }
  if (n.endsWith(".appimage.tar.gz")) {
    return "linux-x86_64";
  }
  return null;
}

const platforms = {};
for (const { artifact, sig } of signed) {
  const key = platformKeyFor(artifact);
  if (!key) {
    console.warn(`跳过无法识别平台的产物: ${artifact}`);
    continue;
  }
  // 用 tag 拼下载地址：指向**本次发布**的附件，而不是 latest。
  // latest 在并发发布或回滚时会指向别的版本。
  const fileName = artifact.split(/[\\/]/).pop();
  platforms[key] = {
    signature: readFileSync(sig, "utf8").trim(),
    url: `https://github.com/${repo}/releases/download/${rawTag}/${fileName}`,
  };
}

if (Object.keys(platforms).length === 0) {
  console.error("识别到签名文件，但没有一个是受支持的平台产物。");
  process.exit(1);
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms,
};

const outPath = join(BUNDLE_DIR, "latest.json");
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`已写出 ${outPath}`);
console.log(JSON.stringify(manifest, null, 2));
