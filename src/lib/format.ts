/**
 * 面向界面的格式化工具。
 *
 * 抽成一处的理由：主页列表与「文件详情」面板要显示同一批数值（大小、时间），
 * 各写一份的话，同一个 16123 字节的文件会在两处显示成 "15.7 KB" 和 "16 KB"。
 */

/** 字节数 → 人类可读大小。 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * ISO 时间 → 列表里用的紧凑时间。
 *
 * 今天的只显示时:分，往前的补上月/日 —— 列表里「今天 17:09」比
 * 「2026/10/29 17:09」好扫，但跨天的必须写清日期，否则看不出新旧。
 * 解析失败时原样返回，不编造时间。
 */
export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return `今天 ${timeStr}`;
    return `${d.toLocaleDateString([], { month: "2-digit", day: "2-digit" })} ${timeStr}`;
  } catch {
    return iso;
  }
}

/** ISO 时间 → 详情面板用的完整时间戳（年月日时分）。 */
export function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
