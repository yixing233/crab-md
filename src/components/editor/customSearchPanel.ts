import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceNext,
  replaceAll,
  selectMatches,
  setSearchQuery,
  SearchQuery,
} from "@codemirror/search";
import {
  EditorView,
  runScopeHandlers,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";

let shouldExpandReplaceOnOpen = false;
let activePanelInstance: CustomSearchPanel | null = null;

/**
 * 请求打开搜索面板并直接处于“展开替换”状态（如右键菜单“查找 / 替换”）。
 */
export function openSearchWithReplace(view: EditorView): void {
  if (activePanelInstance) {
    activePanelInstance.setExpanded(true);
  } else {
    shouldExpandReplaceOnOpen = true;
    openSearchPanel(view);
    shouldExpandReplaceOnOpen = false;
  }
}

function phrase(view: EditorView, text: string): string {
  return view.state.phrase(text);
}

function elt<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, unknown> | null,
  children?: Array<Node | string>,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === "class" || key === "className") {
        element.className = String(value);
      } else if (key.startsWith("on") && typeof value === "function") {
        element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (typeof value === "boolean") {
        if (value) element.setAttribute(key, "");
      } else {
        element.setAttribute(key, String(value));
      }
    }
  }
  if (children) {
    for (const child of children) {
      if (typeof child === "string") {
        element.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        element.appendChild(child);
      }
    }
  }
  return element;
}

function createLucideSvg(
  paths: Array<{ tag: string; attrs: Record<string, string> }>,
  size = 14,
  className = "cm-search-icon",
): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `lucide ${className}`);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const item of paths) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", item.tag);
    for (const [k, v] of Object.entries(item.attrs)) {
      el.setAttribute(k, v);
    }
    svg.appendChild(el);
  }
  return svg;
}

/**
 * 现代化的 CodeMirror 搜索与替换面板。
 * 紧凑一体化单行设计，全量使用 Lucide 图标规范，选项徽章集成在输入框中，替换作为可折叠展开的二级抽屉。
 */
export class CustomSearchPanel implements Panel {
  readonly view: EditorView;
  readonly dom: HTMLElement;
  readonly searchField: HTMLInputElement;
  readonly replaceField: HTMLInputElement;
  readonly caseField: HTMLInputElement;
  readonly reField: HTMLInputElement;
  readonly wordField: HTMLInputElement;
  readonly countBadge: HTMLElement;
  readonly toggleButton: HTMLButtonElement;
  readonly replaceRow: HTMLElement;

  private query: SearchQuery;
  private expanded: boolean;

  readonly top = true;

  constructor(view: EditorView) {
    this.view = view;
    this.query = getSearchQuery(view.state);
    this.expanded = shouldExpandReplaceOnOpen;
    activePanelInstance = this;

    this.commit = this.commit.bind(this);

    // 切换展开/收起替换行按钮 (Lucide ChevronRight: m9 18 6-6-6-6)
    const chevronSvg = createLucideSvg(
      [{ tag: "path", attrs: { d: "m9 18 6-6-6-6" } }],
      14,
      "cm-search-chevron",
    );

    this.toggleButton = elt(
      "button",
      {
        type: "button",
        class: "cm-button cm-search-icon-btn cm-search-toggle",
        name: "toggleReplace",
        "aria-label": this.expanded ? "收起替换" : "展开替换",
        title: this.expanded ? "收起替换" : "展开替换",
        "aria-expanded": String(this.expanded),
        onclick: () => this.setExpanded(!this.expanded),
      },
      [chevronSvg],
    );

    this.searchField = elt("input", {
      value: this.query.search,
      placeholder: phrase(view, "Find"),
      "aria-label": phrase(view, "Find"),
      class: "cm-textfield cm-search-input",
      name: "search",
      form: "",
      "main-field": "true",
      oninput: this.commit,
      onchange: this.commit,
    });

    this.countBadge = elt("span", {
      class: "cm-search-count",
      "aria-live": "polite",
    });

    this.replaceField = elt("input", {
      value: this.query.replace,
      placeholder: phrase(view, "Replace"),
      "aria-label": phrase(view, "Replace"),
      class: "cm-textfield cm-search-input",
      name: "replace",
      form: "",
      oninput: this.commit,
      onchange: this.commit,
    });

    this.caseField = elt("input", {
      type: "checkbox",
      name: "case",
      form: "",
      "aria-label": phrase(view, "match case"),
      checked: this.query.caseSensitive,
      onchange: this.commit,
    });

    this.reField = elt("input", {
      type: "checkbox",
      name: "re",
      form: "",
      "aria-label": phrase(view, "regexp"),
      checked: this.query.regexp,
      onchange: this.commit,
    });

    this.wordField = elt("input", {
      type: "checkbox",
      name: "word",
      form: "",
      "aria-label": phrase(view, "by word"),
      checked: this.query.wholeWord,
      onchange: this.commit,
    });

    const createOption = (
      input: HTMLInputElement,
      iconPaths: Array<{ tag: string; attrs: Record<string, string> }>,
      labelPhraseKey: string,
      shortcut: string,
    ) => {
      const badge = elt(
        "span",
        { class: "cm-search-badge", "aria-hidden": "true" },
        [createLucideSvg(iconPaths, 13, "cm-search-option-icon")],
      );
      const srText = elt("span", { class: "cm-sr-only" }, [phrase(view, labelPhraseKey)]);
      const label = elt(
        "label",
        {
          class: "cm-search-option",
          title: `${phrase(view, labelPhraseKey)} (${shortcut})`,
          "data-active": String(input.checked),
        },
        [input, badge, srText],
      );
      input.addEventListener("change", () => {
        label.setAttribute("data-active", String(input.checked));
      });
      return label;
    };

    // Lucide CaseSensitive
    const caseOption = createOption(
      this.caseField,
      [
        { tag: "path", attrs: { d: "m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" } },
        { tag: "path", attrs: { d: "M22 9v7" } },
        { tag: "path", attrs: { d: "M3.304 13h6.392" } },
        { tag: "circle", attrs: { cx: "18.5", cy: "12.5", r: "3.5" } },
      ],
      "match case",
      "Alt+C",
    );

    // Lucide WholeWord
    const wordOption = createOption(
      this.wordField,
      [
        { tag: "circle", attrs: { cx: "7", cy: "12", r: "3" } },
        { tag: "path", attrs: { d: "M10 9v6" } },
        { tag: "circle", attrs: { cx: "17", cy: "12", r: "3" } },
        { tag: "path", attrs: { d: "M14 7v8" } },
        { tag: "path", attrs: { d: "M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1" } },
      ],
      "by word",
      "Alt+W",
    );

    // Lucide Regex
    const reOption = createOption(
      this.reField,
      [
        { tag: "path", attrs: { d: "M17 3v10" } },
        { tag: "path", attrs: { d: "m12.67 5.5 8.66 5" } },
        { tag: "path", attrs: { d: "m12.67 10.5 8.66-5" } },
        { tag: "path", attrs: { d: "M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z" } },
      ],
      "regexp",
      "Alt+R",
    );

    const searchOptions = elt("div", { class: "cm-search-options" }, [
      caseOption,
      wordOption,
      reOption,
    ]);

    const searchInputBox = elt(
      "div",
      { class: "cm-search-input-box" },
      [this.searchField, this.countBadge, searchOptions],
    );

    // 上一个 (Lucide ChevronUp: m18 15-6-6-6 6)
    const prevButton = elt(
      "button",
      {
        class: "cm-button cm-search-icon-btn",
        name: "prev",
        type: "button",
        "aria-label": phrase(view, "previous"),
        title: `${phrase(view, "previous")} (Shift+Enter)`,
        onclick: () => {
          findPrevious(view);
          this.updateMatchCount();
        },
      },
      [createLucideSvg([{ tag: "path", attrs: { d: "m18 15-6-6-6 6" } }], 14, "cm-search-icon")],
    );

    // 下一个 (Lucide ChevronDown: m6 9 6 6 6-6)
    const nextButton = elt(
      "button",
      {
        class: "cm-button cm-search-icon-btn",
        name: "next",
        type: "button",
        "aria-label": phrase(view, "next"),
        title: `${phrase(view, "next")} (Enter)`,
        onclick: () => {
          findNext(view);
          this.updateMatchCount();
        },
      },
      [createLucideSvg([{ tag: "path", attrs: { d: "m6 9 6 6 6-6" } }], 14, "cm-search-icon")],
    );

    // 全部选择 (Lucide TextSelect + "全部")
    const selectButton = elt(
      "button",
      {
        class: "cm-button cm-search-btn",
        name: "select",
        type: "button",
        "aria-label": phrase(view, "all"),
        title: `${phrase(view, "all")} (Alt+Enter)`,
        onclick: () => {
          selectMatches(view);
          this.updateMatchCount();
        },
      },
      [
        createLucideSvg(
          [
            {
              tag: "path",
              attrs: {
                d: "M14 21h1M14 3h1M19 3a2 2 0 0 1 2 2M21 14v1M21 19a2 2 0 0 1-2 2M21 9v1M3 14v1M3 9v1M5 21a2 2 0 0 1-2-2M5 3a2 2 0 0 0-2 2M7 12h10M7 16h6M7 8h8M9 21h1M9 3h1",
              },
            },
          ],
          12,
          "cm-search-btn-icon",
        ),
        phrase(view, "all"),
      ],
    );

    // 关闭 (Lucide X: M18 6 6 18, m6 6 12 12)
    const closeButton = elt(
      "button",
      {
        name: "close",
        class: "cm-button cm-search-icon-btn cm-search-close",
        type: "button",
        "aria-label": phrase(view, "close"),
        title: `${phrase(view, "close")} (Esc)`,
        onclick: () => closeSearchPanel(view),
      },
      [
        createLucideSvg(
          [
            { tag: "path", attrs: { d: "M18 6 6 18" } },
            { tag: "path", attrs: { d: "m6 6 12 12" } },
          ],
          14,
          "cm-search-icon",
        ),
      ],
    );

    // 查找行（Row 1）
    const findRow = elt("div", { class: "cm-search-row cm-search-row--find" }, [
      this.toggleButton,
      searchInputBox,
      elt("div", { class: "cm-search-button-group" }, [
        prevButton,
        nextButton,
        selectButton,
        closeButton,
      ]),
    ]);

    // 替换行（Row 2，默认折叠）
    // 替换缩进前缀指示图标 (Lucide CornerDownRight: m15 10 5 5-5 5, M4 4v7a4 4 0 0 0 4 4h12)
    const replaceIndent = elt("div", { class: "cm-search-indent", "aria-hidden": "true" }, [
      createLucideSvg(
        [
          { tag: "path", attrs: { d: "m15 10 5 5-5 5" } },
          { tag: "path", attrs: { d: "M4 4v7a4 4 0 0 0 4 4h12" } },
        ],
        13,
        "cm-search-replace-arrow",
      ),
    ]);

    const replaceInputBox = elt(
      "div",
      { class: "cm-search-input-box" },
      [this.replaceField],
    );

    // 替换当前项 (Lucide Replace + "替换")
    const replaceBtn = elt(
      "button",
      {
        class: "cm-button cm-search-btn",
        name: "replace",
        type: "button",
        "aria-label": phrase(view, "replace"),
        title: phrase(view, "replace"),
        onclick: () => {
          replaceNext(view);
          this.updateMatchCount();
        },
      },
      [
        createLucideSvg(
          [
            { tag: "path", attrs: { d: "M14 4a1 1 0 0 1 1-1" } },
            { tag: "path", attrs: { d: "M15 10a1 1 0 0 1-1-1" } },
            { tag: "path", attrs: { d: "M21 4a1 1 0 0 0-1-1" } },
            { tag: "path", attrs: { d: "M21 9a1 1 0 0 1-1 1" } },
            { tag: "path", attrs: { d: "m3 7 3 3 3-3" } },
            { tag: "path", attrs: { d: "M6 10V5a2 2 0 0 1 2-2h2" } },
            { tag: "rect", attrs: { x: "3", y: "14", width: "7", height: "7", rx: "1" } },
          ],
          12,
          "cm-search-btn-icon",
        ),
        phrase(view, "replace"),
      ],
    );

    // 全部替换 (Lucide ReplaceAll + "全部替换")
    const replaceAllBtn = elt(
      "button",
      {
        class: "cm-button cm-search-btn",
        name: "replaceAll",
        type: "button",
        "aria-label": phrase(view, "replace all"),
        title: phrase(view, "replace all"),
        onclick: () => {
          replaceAll(view);
          this.updateMatchCount();
        },
      },
      [
        createLucideSvg(
          [
            { tag: "path", attrs: { d: "M14 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1" } },
            { tag: "path", attrs: { d: "M14 4a1 1 0 0 1 1-1" } },
            { tag: "path", attrs: { d: "M15 10a1 1 0 0 1-1-1" } },
            { tag: "path", attrs: { d: "M19 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1" } },
            { tag: "path", attrs: { d: "M21 4a1 1 0 0 0-1-1" } },
            { tag: "path", attrs: { d: "M21 9a1 1 0 0 1-1 1" } },
            { tag: "path", attrs: { d: "m3 7 3 3 3-3" } },
            { tag: "path", attrs: { d: "M6 10V5a2 2 0 0 1 2-2h2" } },
            { tag: "rect", attrs: { x: "3", y: "14", width: "7", height: "7", rx: "1" } },
          ],
          12,
          "cm-search-btn-icon",
        ),
        phrase(view, "replace all"),
      ],
    );

    this.replaceRow = elt("div", { class: "cm-search-row cm-search-row--replace" }, [
      replaceIndent,
      replaceInputBox,
      elt("div", { class: "cm-search-button-group" }, [replaceBtn, replaceAllBtn]),
    ]);

    if (!this.expanded) {
      this.replaceRow.style.display = "none";
    }

    this.dom = elt(
      "div",
      {
        class: "cm-search",
        "data-expanded": String(this.expanded),
        onkeydown: (e: KeyboardEvent) => this.keydown(e),
      },
      [findRow, this.replaceRow],
    );
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.dom.dataset.expanded = String(expanded);
    this.toggleButton.setAttribute("aria-expanded", String(expanded));
    this.toggleButton.setAttribute("aria-label", expanded ? "收起替换" : "展开替换");
    this.toggleButton.title = expanded ? "收起替换" : "展开替换";
    this.replaceRow.style.display = expanded ? "flex" : "none";

    if (expanded) {
      this.replaceField.select();
    } else {
      this.searchField.focus();
    }
    this.updatePosition();
  }

  commit(): void {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.caseField.checked,
      regexp: this.reField.checked,
      wholeWord: this.wordField.checked,
      replace: this.replaceField.value,
    });
    if (!query.eq(this.query)) {
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }
    this.caseField.parentElement?.setAttribute("data-active", String(this.caseField.checked));
    this.reField.parentElement?.setAttribute("data-active", String(this.reField.checked));
    this.wordField.parentElement?.setAttribute("data-active", String(this.wordField.checked));
    this.updateMatchCount();
  }

  private updateMatchCount(): void {
    if (!this.countBadge) return;
    const searchVal = this.searchField.value;
    if (!searchVal) {
      this.countBadge.textContent = "";
      this.countBadge.style.display = "none";
      return;
    }
    this.countBadge.style.display = "inline-flex";
    if (!this.query.valid) {
      this.countBadge.textContent = "正则错误";
      this.countBadge.dataset.error = "true";
      delete this.countBadge.dataset.empty;
      return;
    }
    delete this.countBadge.dataset.error;
    try {
      let count = 0;
      let current = 0;
      const sel = this.view.state.selection.main;
      const cursor = this.query.getCursor(this.view.state);
      for (let m = cursor.next(); !m.done; m = cursor.next()) {
        count++;
        if (m.value.from <= sel.from && m.value.to >= sel.to) {
          current = count;
        }
        if (count >= 1000) break;
      }
      if (count === 0) {
        this.countBadge.textContent = "无结果";
        this.countBadge.dataset.empty = "true";
      } else {
        delete this.countBadge.dataset.empty;
        const total = count >= 1000 ? "999+" : String(count);
        this.countBadge.textContent = current > 0 ? `${current} / ${total}` : total;
      }
    } catch {
      this.countBadge.textContent = "";
    }
  }

  keydown(e: KeyboardEvent): void {
    if (runScopeHandlers(this.view, e, "search-panel")) {
      e.preventDefault();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(this.view);
      return;
    }

    // Alt+C: 区分大小写
    if (e.altKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      this.caseField.checked = !this.caseField.checked;
      this.commit();
      return;
    }

    // Alt+W: 全词匹配
    if (e.altKey && (e.key === "w" || e.key === "W")) {
      e.preventDefault();
      this.wordField.checked = !this.wordField.checked;
      this.commit();
      return;
    }

    // Alt+R: 正则表达式
    if (e.altKey && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      this.reField.checked = !this.reField.checked;
      this.commit();
      return;
    }

    if (e.key === "Enter" && e.target === this.searchField) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(this.view);
      this.updateMatchCount();
    } else if (e.key === "Enter" && e.target === this.replaceField) {
      e.preventDefault();
      if (e.altKey) {
        replaceAll(this.view);
      } else {
        replaceNext(this.view);
      }
      this.updateMatchCount();
    } else if (e.key === "ArrowDown" && e.target === this.searchField && this.expanded) {
      e.preventDefault();
      this.replaceField.focus();
    } else if (e.key === "ArrowUp" && e.target === this.replaceField) {
      e.preventDefault();
      this.searchField.focus();
    }
  }

  update(update: ViewUpdate): void {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value);
        }
      }
    }
    if (update.docChanged || update.selectionSet) {
      this.updateMatchCount();
      this.updatePosition();
    }
  }

  setQuery(query: SearchQuery): void {
    this.query = query;
    if (this.searchField.value !== query.search) {
      this.searchField.value = query.search;
    }
    if (this.replaceField.value !== query.replace) {
      this.replaceField.value = query.replace;
    }
    this.caseField.checked = query.caseSensitive;
    this.caseField.parentElement?.setAttribute("data-active", String(query.caseSensitive));
    this.reField.checked = query.regexp;
    this.reField.parentElement?.setAttribute("data-active", String(query.regexp));
    this.wordField.checked = query.wholeWord;
    this.wordField.parentElement?.setAttribute("data-active", String(query.wholeWord));
    this.updateMatchCount();
  }

  readonly updatePosition = (): void => {
    if (typeof window === "undefined") return;
    const parentPanels = this.dom.closest<HTMLElement>(".cm-panels-top");
    const target = parentPanels || this.dom;

    const previewEl = document.querySelector<HTMLElement>(".app-pane--preview");
    if (previewEl && previewEl.offsetParent !== null) {
      const rect = previewEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const top = Math.max(10, rect.top + 10);
        const right = Math.max(16, window.innerWidth - rect.right + 20);
        target.style.position = "fixed";
        target.style.top = `${top}px`;
        target.style.right = `${right}px`;
        target.style.left = "auto";
        return;
      }
    }

    const editorEl = this.view.dom;
    if (editorEl) {
      const rect = editorEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const top = Math.max(10, rect.top + 10);
        const right = Math.max(16, window.innerWidth - rect.right + 20);
        target.style.position = "fixed";
        target.style.top = `${top}px`;
        target.style.right = `${right}px`;
        target.style.left = "auto";
      }
    }
  };

  mount(): void {
    this.searchField.select();
    this.updateMatchCount();
    this.updatePosition();
    window.addEventListener("resize", this.updatePosition);
  }

  destroy(): void {
    window.removeEventListener("resize", this.updatePosition);
    if (activePanelInstance === this) {
      activePanelInstance = null;
    }
  }
}

export function createCustomSearchPanel(view: EditorView): Panel {
  return new CustomSearchPanel(view);
}
