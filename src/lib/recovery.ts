import type { DocumentSummary } from "../types/document";

/** 本地未保存草稿的版本化键空间。 */
export const RECOVERY_STORAGE_PREFIX = "crab-md.recovery.v1.";
const RECOVERY_SCHEMA_VERSION = 1;

export interface RecoveryDraft {
  documentId: string;
  content: string;
  /** 写入草稿时正式文档的版本，用于提示外部修改冲突。 */
  baseRevision: number;
  baseContentHash: string;
  updatedAt: number;
}

export interface RecoveryCandidate extends RecoveryDraft {
  title: string;
  currentRevision: number;
  currentContentHash: string;
  conflict: boolean;
}

function storageOrNull(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

export function recoveryStorageKey(documentId: string): string {
  return `${RECOVERY_STORAGE_PREFIX}${encodeURIComponent(documentId)}`;
}

function isDraft(value: unknown, documentId: string): value is RecoveryDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<RecoveryDraft> & { version?: unknown };
  return (
    draft.version === RECOVERY_SCHEMA_VERSION &&
    draft.documentId === documentId &&
    typeof draft.content === "string" &&
    Number.isInteger(draft.baseRevision) &&
    typeof draft.baseContentHash === "string" &&
    Number.isFinite(draft.updatedAt)
  );
}

/** 读取损坏或旧版本草稿时按无草稿处理，并清掉坏数据。 */
export function readRecoveryDraft(
  documentId: string,
  storage?: Storage | null,
): RecoveryDraft | null {
  const target = storageOrNull(storage);
  if (!target) return null;

  try {
    const raw = target.getItem(recoveryStorageKey(documentId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isDraft(parsed, documentId)) {
      target.removeItem(recoveryStorageKey(documentId));
      return null;
    }
    const { documentId: id, content, baseRevision, baseContentHash, updatedAt } = parsed;
    return { documentId: id, content, baseRevision, baseContentHash, updatedAt };
  } catch {
    // localStorage 可能被禁用、损坏或在无痕模式中拒绝访问。
    try {
      target.removeItem(recoveryStorageKey(documentId));
    } catch {
      // 忽略清理失败；恢复功能不能影响编辑器继续工作。
    }
    return null;
  }
}

/** 尽早写入本地草稿；失败时返回 false，但不阻塞正式自动保存。 */
export function writeRecoveryDraft(
  draft: RecoveryDraft,
  storage?: Storage | null,
): boolean {
  const target = storageOrNull(storage);
  if (!target) return false;

  try {
    target.setItem(
      recoveryStorageKey(draft.documentId),
      JSON.stringify({ version: RECOVERY_SCHEMA_VERSION, ...draft }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearRecoveryDraft(documentId: string, storage?: Storage | null): void {
  const target = storageOrNull(storage);
  if (!target) return;
  try {
    target.removeItem(recoveryStorageKey(documentId));
  } catch {
    // 清理失败不应让文档操作失败。
  }
}

/** 切换数据目录时清理所有候选，避免不同工作区复用同一个文档 UUID。 */
export function clearAllRecoveryDrafts(storage?: Storage | null): void {
  const target = storageOrNull(storage);
  if (!target) return;
  try {
    for (const key of allRecoveryKeys(target)) target.removeItem(key);
  } catch {
    // localStorage 不可用时没有可安全执行的补偿动作。
  }
}

/** 收集存储中全部恢复草稿的键（顺序与 Storage 一致）。 */
function allRecoveryKeys(target: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < target.length; index += 1) {
    const key = target.key(index);
    if (key?.startsWith(RECOVERY_STORAGE_PREFIX)) keys.push(key);
  }
  return keys;
}

/** 当前存了多少份恢复草稿（设置页显示占用情况用）。读取失败按 0 处理。 */
export function countRecoveryDrafts(storage?: Storage | null): number {
  const target = storageOrNull(storage);
  if (!target) return 0;
  try {
    return allRecoveryKeys(target).length;
  } catch {
    return 0;
  }
}

export function toRecoveryCandidate(
  draft: RecoveryDraft,
  document: DocumentSummary,
  currentContent: string,
): RecoveryCandidate | null {
  if (draft.documentId !== document.id || draft.content === currentContent) {
    return null;
  }

  return {
    ...draft,
    title: document.title,
    currentRevision: document.revision,
    currentContentHash: document.contentHash,
    conflict:
      draft.baseRevision !== document.revision || draft.baseContentHash !== document.contentHash,
  };
}
