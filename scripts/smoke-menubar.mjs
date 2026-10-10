/**
 * 菜单栏真实浏览器核对（一次性脚本，不进构建、不被 vitest 收集）。
 *
 * 为什么需要：jsdom 里 `getBoundingClientRect()` 恒为 0，所以「菜单到底开在
 * 触发器下方哪一格」「锚点范围够不够大」「窄视口下会不会跑出屏幕」这些
 * 单测根本测不到 —— 与 scripts/smoke-render.mjs 同样的理由。
 *
 * 用法：
 *   1) npx vite --config vite.harness.config.ts      （另开终端）
 *   2) 清掉 NODE_OPTIONS 后，从装了 playwright 的目录运行本脚本：
 *      $env:NODE_OPTIONS=""; node smoke-menubar.mjs
 */
import { chromium } from "playwright";

const URL = process.env.HARNESS_URL ?? "http://localhost:5199/harness.html";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error" && !msg.text().includes("favicon")) consoleErrors.push(msg.text());
});
await page.goto(URL, { waitUntil: "networkidle" });

// harness 会默认铺开设置面板，并在左上角固定一排演示按钮 —— 两者都盖在
// 工具栏上，真实点击会被它们截走。先藏掉（与 smoke-render.mjs 同样的处理）。
await page.evaluate(() => {
  for (const sel of [".settings-overlay", ".update-bar"]) {
    const el = document.querySelector(sel);
    if (el) el.style.display = "none";
  }
  for (const el of document.querySelectorAll("div")) {
    if (getComputedStyle(el).position === "fixed") el.style.display = "none";
  }
});

/** 菜单栏里某个顶级菜单的触发器。 */
const trigger = (label) =>
  page.locator(".app-menubar .app-menubar__trigger", { hasText: label }).first();

const triggers = await page.locator(".app-menubar .app-menubar__trigger").allTextContents();
const colorsClosed = await page
  .locator(".app-menubar .app-menubar__trigger")
  .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));

// 1) 文件菜单开在触发器正下方。
await trigger("文件").click();
const rootMenu = page.locator('[role="menu"][data-menu-depth="0"]');
await rootMenu.waitFor();
const fileMenuBox = await rootMenu.boundingBox();
const fileTriggerBox = await trigger("文件").boundingBox();
const fileItems = await rootMenu.locator("button").allTextContents();
const colorsOpen = await page
  .locator(".app-menubar .app-menubar__trigger")
  .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
await page.screenshot({ path: "menubar-1-file.png" });

// 2) 直接从「文件」切到「视图」：若 anchorRef 只包住单个按钮，这次点击会被
//    当成「点了菜单外面」，同一次事件里先开再关，菜单会一闪就没。
await trigger("视图").click();
await page.waitForTimeout(150);
const viewMenu = page.locator('[role="menu"][data-menu-depth="0"]');
const viewMenuVisible = await viewMenu.isVisible().catch(() => false);
const viewItems = viewMenuVisible ? await viewMenu.locator("button").allTextContents() : [];
const radios = await page
  .locator('[role="menuitemradio"]')
  .evaluateAll((els) =>
    els.map((el) => ({ label: el.textContent, checked: el.getAttribute("aria-checked") })),
  );

// 3) 子菜单：悬停「主题」，确认向右展开且没越出视口。
await page.locator('[role="menuitem"][aria-haspopup="menu"]').filter({ hasText: "主题" }).hover();
await page.waitForTimeout(250);
const subMenu = page.locator('[role="menu"][data-menu-depth="1"]');
const subBox = await subMenu.boundingBox().catch(() => null);
const subItems = subBox ? await subMenu.locator("button").allTextContents() : [];
await page.screenshot({ path: "menubar-2-view-submenu.png" });

// 4) 窄视口：下拉不应跑出右边界。
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 420, height: 600 });
await trigger("文件").click();
await page.waitForTimeout(150);
const narrowBox = await page.locator('[role="menu"][data-menu-depth="0"]').boundingBox();
await page.screenshot({ path: "menubar-3-narrow.png" });

console.log(
  JSON.stringify(
    {
      triggers,
      colorsClosed,
      colorsOpen,
      file: {
        triggerBox: fileTriggerBox,
        menuBox: fileMenuBox,
        gapBelowTrigger: fileMenuBox.y - fileTriggerBox.y - fileTriggerBox.height,
        leftAlignedWithTrigger: Math.abs(fileMenuBox.x - fileTriggerBox.x) < 2,
        items: fileItems,
      },
      switchedToViewMenu: { stillOpen: viewMenuVisible, items: viewItems },
      radios,
      submenu: { box: subBox, items: subItems, insideViewport: subBox ? subBox.x + subBox.width <= 1280 : null },
      narrow: {
        viewportWidth: 420,
        box: narrowBox,
        insideViewport: narrowBox ? narrowBox.x + narrowBox.width <= 420 && narrowBox.x >= 0 : null,
      },
      consoleErrors,
    },
    null,
    2,
  ),
);

await browser.close();
