/** 计算字符串在等宽字体下的显示宽度（中文/CJK 占 2 字符宽）。 */
export function stringWidth(str: string): number {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // 匹配全角/CJK 字符区间
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/** 拆解单行表格单元格。 */
export function parseTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

/** 是否是 Markdown 表格分隔线（如 |---|:---:|---:|）。 */
export function isTableSeparator(line: string): boolean {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** 是否属于 Markdown 表格行。 */
export function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return (trimmed.startsWith("|") && trimmed.includes("|", 1)) || (trimmed.includes("|") && trimmed.endsWith("|"));
}

/**
 * 格式化并美化表格对齐，使所有垂直竖线在等宽字体下完全对齐。
 */
export function alignMarkdownTable(tableLines: string[]): string[] {
  if (tableLines.length === 0) return tableLines;

  const rows = tableLines.map(parseTableRow);
  const numCols = Math.max(...rows.map((r) => r.length));
  if (numCols === 0) return tableLines;

  // 计算每列的最大显示宽度（至少为 3）
  const colWidths = Array(numCols).fill(3);
  for (const row of rows) {
    row.forEach((cell, i) => {
      colWidths[i] = Math.max(colWidths[i] || 3, stringWidth(cell));
    });
  }

  return rows.map((row, rowIdx) => {
    const isSep = rowIdx === 1 && isTableSeparator(tableLines[rowIdx]);
    const cells = Array(numCols)
      .fill("")
      .map((_, colIdx) => {
        const val = row[colIdx] || "";
        const targetWidth = colWidths[colIdx];
        if (isSep) {
          return "-".repeat(targetWidth);
        }
        const diff = targetWidth - stringWidth(val);
        return val + " ".repeat(Math.max(0, diff));
      });
    return `| ${cells.join(" | ")} |`;
  });
}

/** 在指定行下方插入一行空行。 */
export function insertTableRow(tableLines: string[], currentLineIdx: number): string[] {
  if (tableLines.length === 0) return tableLines;
  const numCols = Math.max(...tableLines.map((l) => parseTableRow(l).length));
  const newRow = `| ${Array(numCols).fill("   ").join(" | ")} |`;

  const copy = [...tableLines];
  // 如果在表头插入，则插在分隔行（第 1 行）下方
  const insertIdx = Math.max(2, currentLineIdx + 1);
  copy.splice(insertIdx, 0, newRow);
  return alignMarkdownTable(copy);
}

/** 删除当前指定行（表头与分隔行受保护不删除）。 */
export function deleteTableRow(tableLines: string[], currentLineIdx: number): string[] {
  // 表头（0）和分隔行（1）不应被作为数据行随意删除，且总行数至少保留 3 行
  if (currentLineIdx <= 1 || tableLines.length <= 3) return tableLines;
  const copy = [...tableLines];
  copy.splice(currentLineIdx, 1);
  return alignMarkdownTable(copy);
}

/** 在当前列右侧插入一列。 */
export function insertTableColumn(tableLines: string[], currentColIdx: number): string[] {
  if (tableLines.length === 0) return tableLines;
  const rows = tableLines.map(parseTableRow);
  const nextRows = rows.map((row, rowIdx) => {
    const copy = [...row];
    const isSep = rowIdx === 1 && isTableSeparator(tableLines[rowIdx]);
    const insertVal = isSep ? "---" : `列 ${copy.length + 1}`;
    copy.splice(Math.max(0, currentColIdx + 1), 0, insertVal);
    return `| ${copy.join(" | ")} |`;
  });
  return alignMarkdownTable(nextRows);
}

/** 删除当前指定列（总列数至少保留 1 列）。 */
export function deleteTableColumn(tableLines: string[], currentColIdx: number): string[] {
  if (tableLines.length === 0) return tableLines;
  const rows = tableLines.map(parseTableRow);
  if (rows[0].length <= 1) return tableLines;

  const nextRows = rows.map((row) => {
    const copy = [...row];
    copy.splice(currentColIdx, 1);
    return `| ${copy.join(" | ")} |`;
  });
  return alignMarkdownTable(nextRows);
}
