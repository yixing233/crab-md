import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, FileEdit } from "lucide-react";
import { Button } from "../ui/Button";
import "../ui/ui.css";
import "./closeModal.css";

export type ClosePromptType =
  | { kind: "save-changes"; id: string; title: string }
  | { kind: "save-and-name"; id: string; suggestedName: string };

export interface CloseDocumentModalProps {
  prompt: ClosePromptType | null;
  onSave: (name?: string) => Promise<void>;
  onDiscard: () => Promise<void>;
  onCancel: () => void;
}

export function CloseDocumentModal({
  prompt,
  onSave,
  onDiscard,
  onCancel,
}: CloseDocumentModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (prompt?.kind === "save-and-name") {
      setName(prompt.suggestedName);
      // 延迟一帧全选文字，方便用户直接按回车确认或敲字覆盖
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [prompt]);

  // 键盘 Esc 处理
  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prompt, onCancel]);

  if (!prompt) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (prompt.kind === "save-and-name") {
      void onSave(name.trim() || prompt.suggestedName);
    } else {
      void onSave();
    }
  };

  const isSaveAndName = prompt.kind === "save-and-name";

  return createPortal(
    <div className="ui-dialog-overlay" onMouseDown={onCancel}>
      <div
        className="ui-dialog close-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isSaveAndName ? "保存并命名笔记" : "保存文档修改"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="close-modal__header">
          {isSaveAndName ? (
            <div className="close-modal__icon close-modal__icon--info">
              <FileEdit size={22} />
            </div>
          ) : (
            <div className="close-modal__icon close-modal__icon--warning">
              <AlertCircle size={22} />
            </div>
          )}
          <h2 className="ui-dialog__title">
            {isSaveAndName ? "保存新笔记" : `是否保存对 “${prompt.title}” 的更改？`}
          </h2>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="ui-dialog__body close-modal__body">
            {isSaveAndName ? (
              <>
                <p className="close-modal__desc">
                  这是一篇新笔记，请为其命名以便日后查找与归档：
                </p>
                <div className="close-modal__field">
                  <label htmlFor="close-modal-name-input" className="close-modal__label">
                    笔记名称
                  </label>
                  <input
                    id="close-modal-name-input"
                    ref={inputRef}
                    type="text"
                    className="close-modal__input"
                    value={name}
                    placeholder="输入笔记名称"
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                  />
                </div>
              </>
            ) : (
              <p className="close-modal__desc">
                如果不保存，你在本次会话中所做的所有编辑更改都将丢失。
              </p>
            )}
          </div>

          <div className="ui-dialog__actions close-modal__actions">
            <Button variant="ghost" size="md" onClick={onCancel}>
              取消
            </Button>
            <Button variant="secondary" size="md" onClick={() => void onDiscard()}>
              不保存
            </Button>
            <Button variant="primary" size="md" type="submit">
              保存
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
