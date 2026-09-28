import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Info,
  Lightbulb,
  ListTodo,
  Quote,
  Sigma,
  Table,
} from "lucide-react";
import "./slashMenu.css";

export interface SlashCommandItem {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  insertText: string;
  cursorOffset?: number;
}

export interface SlashMenuProps {
  open: boolean;
  x: number;
  y: number;
  query?: string;
  onClose: () => void;
  onSelect: (item: SlashCommandItem) => void;
}

const COMMANDS: SlashCommandItem[] = [
  {
    id: "h1",
    label: "一级标题",
    description: "大标题 #",
    icon: <Heading1 size={15} />,
    insertText: "# ",
  },
  {
    id: "h2",
    label: "二级标题",
    description: "中标题 ##",
    icon: <Heading2 size={15} />,
    insertText: "## ",
  },
  {
    id: "h3",
    label: "三级标题",
    description: "小标题 ###",
    icon: <Heading3 size={15} />,
    insertText: "### ",
  },
  {
    id: "table",
    label: "表格",
    description: "插入 2 列 3 行表格",
    icon: <Table size={15} />,
    insertText: "| 列 1 | 列 2 |\n|---|---|\n|  |  |\n",
  },
  {
    id: "code",
    label: "代码块",
    description: "插入围栏代码块 ```",
    icon: <Code size={15} />,
    insertText: "```ts\n\n```\n",
    cursorOffset: 6,
  },
  {
    id: "todo",
    label: "任务清单",
    description: "插入交互式待办项 - [ ]",
    icon: <ListTodo size={15} />,
    insertText: "- [ ] ",
  },
  {
    id: "quote",
    label: "引用段落",
    description: "插入引用块 >",
    icon: <Quote size={15} />,
    insertText: "> ",
  },
  {
    id: "callout-note",
    label: "提示块 (Note)",
    description: "信息补充卡片 > [!NOTE]",
    icon: <Info size={15} />,
    insertText: "> [!NOTE] 提示\n> ",
  },
  {
    id: "callout-tip",
    label: "技巧块 (Tip)",
    description: "实用操作建议 > [!TIP]",
    icon: <Lightbulb size={15} />,
    insertText: "> [!TIP] 技巧\n> ",
  },
  {
    id: "callout-warning",
    label: "警告块 (Warning)",
    description: "关键注意事项 > [!WARNING]",
    icon: <AlertTriangle size={15} />,
    insertText: "> [!WARNING] 注意\n> ",
  },
  {
    id: "math",
    label: "数学公式",
    description: "独立块级 LaTeX 公式 $$",
    icon: <Sigma size={15} />,
    insertText: "$$\n\n$$\n",
    cursorOffset: 3,
  },
];

let lastUsedSlashCommandId: string | null = null;

export function SlashMenu({
  open,
  x,
  y,
  query = "",
  onClose,
  onSelect,
}: SlashMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
  }, [query]);

  // 打开菜单时：如果有上一次使用的命令且当前无查询输入，恢复上次选中的位置并滚动可视
  useEffect(() => {
    if (open) {
      if (!query && lastUsedSlashCommandId) {
        const foundIdx = COMMANDS.findIndex((c) => c.id === lastUsedSlashCommandId);
        if (foundIdx !== -1) {
          setSelectedIndex(foundIdx);
          setTimeout(() => {
            const list = listRef.current;
            if (!list) return;
            const selectedEl = list.querySelector<HTMLElement>('[data-selected="true"]');
            selectedEl?.scrollIntoView?.({ block: "nearest" });
          }, 30);
          return;
        }
      }
      setSelectedIndex(0);
    }
  }, [open]);

  // 输入关键词变化时重置回第 0 项
  useEffect(() => {
    if (query) {
      setSelectedIndex(0);
    }
  }, [query]);

  // 键盘移动时确保可视项在滚动视区内
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selectedEl = list.querySelector<HTMLElement>('[data-selected="true"]');
    selectedEl?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  const handleSelect = (cmd: SlashCommandItem) => {
    lastUsedSlashCommandId = cmd.id;
    onSelect(cmd);
  };

  // 键盘操作监听
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (filteredCommands.length === 0 ? 0 : (prev + 1) % filteredCommands.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredCommands.length === 0 ? 0 : (prev - 1 + filteredCommands.length) % filteredCommands.length,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          handleSelect(filteredCommands[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, filteredCommands, selectedIndex, onSelect, onClose]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="slash-menu"
      role="menu"
      aria-label="快捷插入菜单"
      style={{
        top: Math.min(y, window.innerHeight - 320),
        left: Math.min(x, window.innerWidth - 260),
      }}
    >
      <div className="slash-menu__header">快捷插入块</div>
      <div ref={listRef} className="slash-menu__list">
        {filteredCommands.length === 0 ? (
          <div className="slash-menu__empty">无匹配命令</div>
        ) : (
          filteredCommands.map((cmd, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={cmd.id}
                role="menuitem"
                data-selected={isSelected ? "true" : undefined}
                className="slash-menu__item"
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => handleSelect(cmd)}
              >
                <div className="slash-menu__icon">{cmd.icon}</div>
                <div className="slash-menu__text">
                  <span className="slash-menu__label">{cmd.label}</span>
                  <span className="slash-menu__desc">{cmd.description}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  );
}
