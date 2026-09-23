import { useEffect } from "react";

/**
 * 编辑/预览同步滚动控制（UI_DESIGN_SYSTEM.md）。
 *
 * 在分栏（split）视图模式下，编辑器与预览区并排展示。
 * 开启同步滚动时，滚动其中任意一侧，另一侧按百分比等比跟随。
 * 关闭同步滚动时，两侧完全独立滚动，互不干扰。
 */

export const SYNC_SCROLL_KEY = "crab-md.sync-scroll";

/** 默认开启同步滚动：分栏视图下符合绝大多数 Markdown 用户的直觉。 */
export const DEFAULT_SYNC_SCROLL = true;

/**
 * 校验并读取已存储的同步滚动偏好。
 * "false" / "0" / "disabled" 解析为 false，其余（包含 null / 初始启动）回退默认 true。
 */
export function readStoredSyncScroll(raw: string | null): boolean {
  if (raw === null || raw.trim() === "") return DEFAULT_SYNC_SCROLL;
  return raw !== "false" && raw !== "0" && raw !== "disabled";
}

/**
 * 设置编辑器与预览区之间的双向同步滚动。
 *
 * 防抖与防循环机制：
 * 1. 采用 `activeSource` 锁（"editor" | "preview" | null）。
 *    当用户滚动一侧（如编辑区）时，将锁置为 "editor"。
 *    程序自动滚动预览区引发的 preview scroll 事件会因为锁为 "editor" 而被直接忽略，
 *    彻底避免「A 滚 -> B 滚 -> B 触发 A 滚」的无限回弹抖动（infinite loop / jitter）。
 * 2. 连续滚动时不断刷新 100ms 解锁定时器，确保滚动条拖拽或触控惯性滚动期间锁不丢失。
 * 3. 停止滚动 100ms 后释放锁，允许用户无缝切换去滚动另一侧。
 * 4. 监听 `pointerenter`，鼠标悬浮在哪一侧且处于空闲状态时预先锁定该侧为主控，提升响应即时性。
 * 5. 初始化挂载时自动按当前编辑区进度对齐预览区，避免切换分栏或开启开关时位置脱节。
 *
 * @returns 销毁函数，调用时彻底解绑所有事件监听并清理计时器。
 */
export function setupSyncScroll(
  editorEl: HTMLElement,
  previewEl: HTMLElement,
): () => void {
  let activeSource: "editor" | "preview" | null = null;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;

  const setSource = (source: "editor" | "preview") => {
    activeSource = source;
    if (releaseTimer !== null) {
      clearTimeout(releaseTimer);
    }
    releaseTimer = setTimeout(() => {
      activeSource = null;
      releaseTimer = null;
    }, 100);
  };

  const onEditorScroll = () => {
    if (activeSource === "preview") return;
    setSource("editor");

    const maxEditor = editorEl.scrollHeight - editorEl.clientHeight;
    if (maxEditor <= 0) return;
    const ratio = Math.min(1, Math.max(0, editorEl.scrollTop / maxEditor));

    const maxPreview = previewEl.scrollHeight - previewEl.clientHeight;
    if (maxPreview > 0) {
      previewEl.scrollTop = Math.round(ratio * maxPreview);
    }
  };

  const onPreviewScroll = () => {
    if (activeSource === "editor") return;
    setSource("preview");

    const maxPreview = previewEl.scrollHeight - previewEl.clientHeight;
    if (maxPreview <= 0) return;
    const ratio = Math.min(1, Math.max(0, previewEl.scrollTop / maxPreview));

    const maxEditor = editorEl.scrollHeight - editorEl.clientHeight;
    if (maxEditor > 0) {
      editorEl.scrollTop = Math.round(ratio * maxEditor);
    }
  };

  const onEditorPointer = () => {
    if (activeSource === null) activeSource = "editor";
  };
  const onPreviewPointer = () => {
    if (activeSource === null) activeSource = "preview";
  };

  editorEl.addEventListener("scroll", onEditorScroll, { passive: true });
  previewEl.addEventListener("scroll", onPreviewScroll, { passive: true });
  editorEl.addEventListener("pointerenter", onEditorPointer, { passive: true });
  previewEl.addEventListener("pointerenter", onPreviewPointer, { passive: true });

  // 初始对齐：若当前已有滚动距离，让预览区对齐到编辑区
  const syncEditorToPreview = () => {
    const maxEditor = editorEl.scrollHeight - editorEl.clientHeight;
    if (maxEditor > 0) {
      const ratio = Math.min(1, Math.max(0, editorEl.scrollTop / maxEditor));
      const maxPreview = previewEl.scrollHeight - previewEl.clientHeight;
      if (maxPreview > 0) {
        previewEl.scrollTop = Math.round(ratio * maxPreview);
      }
    }
  };

  let rafHandle: number | null = null;
  let timerHandle: ReturnType<typeof setTimeout> | null = null;

  if (typeof requestAnimationFrame === "function") {
    rafHandle = requestAnimationFrame(syncEditorToPreview);
  } else {
    timerHandle = setTimeout(syncEditorToPreview, 0);
  }

  return () => {
    if (rafHandle !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafHandle);
    }
    if (timerHandle !== null) {
      clearTimeout(timerHandle);
    }
    if (releaseTimer !== null) {
      clearTimeout(releaseTimer);
      releaseTimer = null;
    }
    editorEl.removeEventListener("scroll", onEditorScroll);
    previewEl.removeEventListener("scroll", onPreviewScroll);
    editorEl.removeEventListener("pointerenter", onEditorPointer);
    previewEl.removeEventListener("pointerenter", onPreviewPointer);
  };
}

export interface UseSyncScrollOptions {
  editorEl: HTMLElement | null;
  previewEl: HTMLElement | null;
  enabled: boolean;
}

/**
 * React Hook：在组件中声明式管理同步滚动生命周期。
 */
export function useSyncScroll({
  editorEl,
  previewEl,
  enabled,
}: UseSyncScrollOptions): void {
  useEffect(() => {
    if (!enabled || !editorEl || !previewEl) return;
    return setupSyncScroll(editorEl, previewEl);
  }, [enabled, editorEl, previewEl]);
}
