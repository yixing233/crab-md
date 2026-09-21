/**
 * 客户端日志（ARCHITECTURE.md §23 Logging and Diagnostics）。
 *
 * §23 要求记录「对调试有用的操作性失败」（文档 I/O 失败、迁移失败等），
 * 并且明确 **MUST NOT** 记录密码、原始令牌或不必要的文档内容。
 *
 * 因此这里的约束是：
 * - 只记录**稳定错误码**与操作名，不记录正文
 * - 不记录文件路径全文（路径可能含用户名等信息）
 * - 控制台输出保持简洁，便于用户复制给我们排查
 *
 * 之所以集中在这里而不是各处 `console.error`：便于将来统一接到
 * Tauri 的文件日志或崩溃上报，而不用回头改几十个调用点。
 */

export type LogContext = {
  /** 操作名，例如 "saveDocument"。 */
  op: string;
  /** 稳定错误码，例如 "IO_ERROR"。 */
  code?: string;
  /** 文档 id（UUID，非用户内容，可安全记录）。 */
  documentId?: string;
};

/** 内存中的最近日志，供将来「诊断」界面读取。 */
const recent: string[] = [];
const MAX_RECENT = 50;

function record(line: string): void {
  recent.push(line);
  if (recent.length > MAX_RECENT) recent.shift();
}

/**
 * 记录一次操作性失败。
 *
 * 注意：`context` 里**不要**传文档内容、令牌或完整路径 —— 调用方负责这一点，
 * 此处只做格式化。这样即使将来接入远程上报也不会泄漏内容。
 */
export function logFailure(context: LogContext, raw?: unknown): void {
  const parts = [context.op];
  if (context.code) parts.push(context.code);
  if (context.documentId) parts.push(`doc=${context.documentId}`);
  const line = `[crab-md] ${parts.join(" ")}`;

  // 开发期给出原始错误对象；生产只给稳定码，避免把内部结构暴露到用户可复制的地方。
  if (import.meta.env?.DEV) {
    console.error(line, raw);
  } else {
    console.error(line);
  }
  record(line);
}

/** 记录一条非失败信息（启动、迁移完成等）。 */
export function logInfo(message: string, detail?: string): void {
  const line = detail ? `[crab-md] ${message} ${detail}` : `[crab-md] ${message}`;
  console.info(line);
  record(line);
}

/** 读取最近日志（诊断用）。返回副本，避免外部修改内部状态。 */
export function recentLogs(): string[] {
  return [...recent];
}

/** 仅测试用：清空缓冲。 */
export function __clearLogs(): void {
  recent.length = 0;
}
