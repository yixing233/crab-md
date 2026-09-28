import { describe, expect, it } from "vitest";
import {
  alignMarkdownTable,
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  isMarkdownTableRow,
  stringWidth,
} from "./tableHelper";

describe("tableHelper", () => {
  it("calculates string visual width taking CJK into account", () => {
    expect(stringWidth("hello")).toBe(5);
    expect(stringWidth("你好")).toBe(4);
    expect(stringWidth("a中文b")).toBe(6);
  });

  it("detects markdown table rows", () => {
    expect(isMarkdownTableRow("| a | b |")).toBe(true);
    expect(isMarkdownTableRow("|---|---|")).toBe(true);
    expect(isMarkdownTableRow("普通文本")).toBe(false);
  });

  it("aligns markdown tables evenly", () => {
    const table = ["| 标题 | 备注 |", "|---|---|", "| 短 | 详细说明内容 |"];
    const aligned = alignMarkdownTable(table);
    expect(aligned).toHaveLength(3);
    // 第一行应该对齐
    expect(aligned[0]).toMatch(/^\|\s+标题\s+\|\s+备注\s+\|$/);
    expect(aligned[1]).toMatch(/^\|\s+-+\s+\|\s+-+\s+\|$/);
  });

  it("inserts row into table", () => {
    const table = ["| A | B |", "|---|---|", "| 1 | 2 |"];
    const next = insertTableRow(table, 2);
    expect(next).toHaveLength(4);
  });

  it("deletes row from table safely", () => {
    const table = ["| A | B |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |"];
    const next = deleteTableRow(table, 2);
    expect(next).toHaveLength(3);

    // 表头和分隔行不被误删
    expect(deleteTableRow(table, 0)).toHaveLength(4);
    expect(deleteTableRow(table, 1)).toHaveLength(4);
  });

  it("inserts column into table", () => {
    const table = ["| A | B |", "|---|---|", "| 1 | 2 |"];
    const next = insertTableColumn(table, 1);
    expect(next[0]).toContain("列 3");
  });

  it("deletes column from table", () => {
    const table = ["| A | B | C |", "|---|---|---|", "| 1 | 2 | 3 |"];
    const next = deleteTableColumn(table, 1);
    expect(next[0]).not.toContain("B");
    expect(next[0]).toContain("A");
    expect(next[0]).toContain("C");
  });
});
