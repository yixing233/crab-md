import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

/**
 * 用 DOM 解析判断是否真的被注入，而不是字符串包含。
 *
 * 字符串断言分不清「作为属性生效」与「只是 style 值里的转义文本」——
 * 后者完全无害。之前的 javascript: 断言就吃过这个假失败的亏。
 */
function parse(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

/** 收集元素上真实存在的所有属性名（小写）。 */
function attributeNames(el: Element): string[] {
  return Array.from(el.attributes).map((a) => a.name.toLowerCase());
}

describe("per-selection font spans (DOM-parsed)", () => {
  it("keeps a valid font-family on a span", () => {
    const html = renderMarkdown('<span style="font-family:SimSun">中文</span>');
    const span = parse(html).querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.style.fontFamily).toContain("SimSun");
  });

  it("keeps a quoted multi-word font name", () => {
    const html = renderMarkdown(
      '<span style="font-family:&quot;Times New Roman&quot;">Hello</span>',
    );
    const span = parse(html).querySelector("span");
    expect(span!.style.fontFamily).toContain("Times New Roman");
  });

  it("keeps a font stack with commas", () => {
    const html = renderMarkdown(
      '<span style="font-family:SimSun, &quot;Songti SC&quot;, serif">文</span>',
    );
    const span = parse(html).querySelector("span");
    expect(span!.style.fontFamily).toContain("SimSun");
  });

  it("does not create a real event-handler attribute from the font value", () => {
    const html = renderMarkdown(
      '<span style="font-family:x&quot; onmouseover=&quot;alert(1)">t</span>',
    );
    const el = parse(html).querySelector("span");
    expect(el).not.toBeNull();
    // 关键：断言**真实属性**里没有事件处理器。字符串里出现
    // "onmouseover" 只是 style 值内的转义文本，无害。
    const names = attributeNames(el!);
    expect(names.some((n) => n.startsWith("on"))).toBe(false);
    expect(el!.getAttribute("onmouseover")).toBeNull();
  });

  it("cannot inject a script element through the font value", () => {
    const html = renderMarkdown(
      '<span style="font-family:</style><script>alert(1)</script>">x</span>',
    );
    expect(parse(html).querySelector("script")).toBeNull();
  });

  it("drops dangerous properties mixed into the same style attribute", () => {
    // 允许了 font-family，但不该顺带放行 position —— 那是界面覆盖攻击。
    const html = renderMarkdown(
      '<span style="font-family:SimSun;position:fixed;inset:0;z-index:99999">覆盖</span>',
    );
    const el = parse(html).querySelector("span");
    expect(el!.style.fontFamily).toContain("SimSun");
    expect(el!.style.position).toBe("");
    expect(el!.style.zIndex).toBe("");
  });

  it("survives inside markdown emphasis", () => {
    const html = renderMarkdown('**粗体 <span style="font-family:KaiTi">楷</span>**');
    const host = parse(html);
    expect(host.querySelector("strong")).not.toBeNull();
    expect(host.querySelector("span")!.style.fontFamily).toContain("KaiTi");
  });
});
