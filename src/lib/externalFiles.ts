/**
 * 外部文件（从磁盘原位打开的文件）的路径约定。
 *
 * 单独成模块的理由：这套约定必须**三处一致** ——
 * - 标签页 id（`ext:<绝对路径>`，App 与侧栏列表都靠它判断高亮）；
 * - 数据库记录的路径（Rust 侧按大小写归一去重）；
 * - 「是不是同一个文件」的判断（Windows 路径大小写不敏感，分隔符有两种写法）。
 *
 * 三处各写一份迟早会漂移：标签高亮失效、同一文件在列表里出现两行，
 * 或者重启后标签被判成「记录不存在」而被误删。
 */

/** 外部文件标签页 id 的前缀。Rust 侧测试也依赖这个约定。 */
export const EXTERNAL_TAB_PREFIX = "ext:";

/** 绝对路径 → 标签页 id。 */
export function externalTabId(path: string): string {
  return `${EXTERNAL_TAB_PREFIX}${path}`;
}

/** 标签页 id → 绝对路径；不是外部标签页时返回 null。 */
export function externalPathOf(tabId: string): string | null {
  return tabId.startsWith(EXTERNAL_TAB_PREFIX)
    ? tabId.slice(EXTERNAL_TAB_PREFIX.length)
    : null;
}

/**
 * 路径的末段作为显示名。
 *
 * 仅在没有数据库记录时兜底（记录里有用户看到的原始文件名）。
 */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * 路径是否属于 Windows 语义。
 *
 * 判据是路径**本身**的形态：盘符（`E:`）或反斜杠。
 * 只看原始写法，不看平台 —— jsdom 里 `navigator.platform` 不可靠，
 * 而「这个路径长什么样」才是决定大小写敏感性的直接依据。
 */
function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:/.test(path) || path.includes("\\");
}

/**
 * 把路径归一成可比较的形式。
 *
 * 大小写是否敏感必须先判、再转换分隔符：反过来做的话，
 * `/home/u/A.md` 被折成 `\home\u\A.md` 后看起来就像 Windows 路径，
 * 两个不同的 POSIX 文件会被误判成同一个。
 *
 * 与 Rust 侧 `path_key`（external_files.rs / opened_files.rs）是同一套规则：
 * 列表合并、历史去重都靠它当键，两层各写各的必然漂移。
 */
export function pathKey(path: string): string {
  if (isWindowsPath(path)) {
    return path.replace(/\//g, "\\").toLowerCase();
  }
  return path.replace(/\\/g, "/");
}

/**
 * 两个路径是否指向同一个文件。
 *
 * 分隔符视为等价（`E:/notes/a.md` 与 `E:\notes\a.md` 是同一个文件）；
 * Windows 路径再折叠大小写 —— 同一个文件用两种写法出现时，列表里出现
 * 两行、标签高亮对不上，都是从这里漏出去的。
 *
 * 不做 `..` 归约：调用方给的要么是数据库里的记录，要么是文件对话框的
 * 返回值，都是规范绝对路径；多此一举的规范化反而可能改变语义。
 */
export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/**
 * 路径是否可能是磁盘上的真实文件（而不是工作区文档 id）。
 *
 * 侧栏与主页把「工作区文档」和「磁盘文件」合并进同一张列表：前者的
 * `path` 字段装的其实是文档 id（UUID），后者才是绝对路径。凡是拿 path
 * 去调「历史记录」「删除磁盘文件」这类**以磁盘路径为键**的命令之前，
 * 都必须先过这一关 —— 否则命令匹配 0 行、静默成功、界面毫无变化。
 *
 * 判据与 Sidebar / HomePage 原本各自写的那份一致（含分隔符就当成路径），
 * 集中到这里是为了让「谁需要分流」只有一处定义。
 */
export function isDiskPath(path: string): boolean {
  return path.includes("/") || path.includes("\\") || path.startsWith(EXTERNAL_TAB_PREFIX);
}
