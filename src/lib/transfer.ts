/**
 * 导入 / 导出：系统文件对话框 + 存储动作的组合。
 *
 * 抽成独立模块而不是写进 App.tsx：
 * - 对话框调用是副作用，集中一处便于统一处理「没有 Tauri 桥」的情况
 *   （单测与浏览器预览下没有原生对话框）；
 * - 返回语义明确（成功 / 用户取消 / 失败），调用方据此决定要不要提示 ——
 *   **取消不该报错**，那只是用户改了主意。
 *
 * 读写全在 Rust 侧完成（ARCHITECTURE.md §7.1：所有文件系统访问经由应用层）。
 * 这里只负责取一个路径字符串。
 */
import { zh } from "./i18n";

export type TransferOutcome =
  | { kind: "ok"; title: string }
  | { kind: "cancelled" }
  | { kind: "failed" };

/** 把标题转成安全的默认文件名（去掉路径分隔符与首尾空白）。 */
export function suggestedFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned === "" ? "未命名" : cleaned;
  return base.toLowerCase().endsWith(".md") ? base : `${base}.md`;
}

/**
 * 弹出「保存到…」对话框，返回所选路径；取消或无桥时返回 null。
 *
 * 单独导出是为了能在没有 Tauri 的环境里被测到「取消」这条路。
 */
export async function pickExportPath(title: string): Promise<string | null> {
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const picked = await save({
      title: zh.transfer.exportTitle,
      defaultPath: suggestedFileName(title),
      filters: [{ name: zh.transfer.markdownFilterName, extensions: ["md", "markdown"] }],
    });
    return typeof picked === "string" ? picked : null;
  } catch {
    // 没有 Tauri 桥（单测、浏览器预览）时没有原生对话框，按「取消」处理。
    return null;
  }
}

/** 弹出「打开文件」对话框，返回所选路径；取消或无桥时返回 null。 */
export async function pickImportPath(): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      directory: false,
      title: zh.transfer.importTitle,
      filters: [{ name: zh.transfer.markdownFilterName, extensions: ["md", "markdown"] }],
    });
    return typeof picked === "string" ? picked : null;
  } catch {
    return null;
  }
}

export interface TransferDeps {
  pickExport: (title: string) => Promise<string | null>;
  pickImport: () => Promise<string | null>;
  exportDocument: (id: string, target: string) => Promise<boolean>;
  importDocument: (source: string) => Promise<{ title: string } | null>;
}

/** 默认依赖：真实对话框 + 真实 store（由调用方注入以保持本模块无 store 依赖）。 */
export const defaultTransferDeps = {
  pickExport: pickExportPath,
  pickImport: pickImportPath,
};

/**
 * 导出流程：选路径 → 写文件。
 *
 * 用户取消返回 `cancelled`，**不是** failed —— 界面不该为此弹错误提示。
 */
export async function runExport(
  deps: Pick<TransferDeps, "pickExport" | "exportDocument">,
  id: string,
  title: string,
): Promise<TransferOutcome> {
  const target = await deps.pickExport(title);
  if (target === null) return { kind: "cancelled" };

  const ok = await deps.exportDocument(id, target);
  return ok ? { kind: "ok", title } : { kind: "failed" };
}

/** 导入流程：选文件 → 收进工作区并打开。 */
export async function runImport(
  deps: Pick<TransferDeps, "pickImport" | "importDocument">,
): Promise<TransferOutcome> {
  const source = await deps.pickImport();
  if (source === null) return { kind: "cancelled" };

  const created = await deps.importDocument(source);
  return created ? { kind: "ok", title: created.title } : { kind: "failed" };
}
