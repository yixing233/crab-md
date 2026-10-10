import { useEffect, useRef, useState, type FormEvent } from "react";
import { Input, Modal } from "antd";
import type { InputRef } from "antd";
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

/**
 * 关闭标签页提示与保存命名弹窗 —— 基于 Ant Design Modal 适配层。
 *
 * 统一对话框的焦点管理、Escape 监听、遮罩层与进出场动画，
 * 视觉令牌映射到应用明暗主题。
 */
export function CloseDocumentModal({
  prompt,
  onSave,
  onDiscard,
  onCancel,
}: CloseDocumentModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<InputRef | null>(null);

  useEffect(() => {
    if (prompt?.kind === "save-and-name") {
      setName(prompt.suggestedName);
      // 延迟一帧全选文字，方便用户直接按回车确认或敲字覆盖
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select?.();
      }, 50);
    }
  }, [prompt]);

  if (!prompt) return null;

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    if (prompt.kind === "save-and-name") {
      void onSave(name.trim() || prompt.suggestedName);
    } else {
      void onSave();
    }
  };

  const isSaveAndName = prompt.kind === "save-and-name";

  return (
    <Modal
      open={Boolean(prompt)}
      title={
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
      }
      onCancel={onCancel}
      footer={[
        <Button key="cancel" variant="ghost" size="md" onClick={onCancel}>
          取消
        </Button>,
        <Button key="discard" variant="secondary" size="md" onClick={() => void onDiscard()}>
          不保存
        </Button>,
        <Button
          key="save"
          variant="primary"
          size="md"
          type="submit"
          form="close-document-form"
        >
          保存
        </Button>,
      ]}
      width={440}
      centered
      destroyOnHidden
      className="ui-dialog-modal close-modal-dialog"
      aria-label={isSaveAndName ? "保存并命名笔记" : "保存文档修改"}
      styles={{
        container: {
          padding: 0,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
        },
        header: {
          padding: "var(--space-5) var(--space-5) 0",
          background: "transparent",
          marginBottom: 0,
        },
        body: { padding: "var(--space-2) var(--space-5) 0" },
        footer: { padding: "var(--space-4) var(--space-5) var(--space-5)" },
        mask: { background: "rgb(0 0 0 / 0.28)" },
      }}
    >
      <form id="close-document-form" onSubmit={handleSubmit}>
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
                <Input
                  id="close-modal-name-input"
                  ref={inputRef}
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
      </form>
    </Modal>
  );
}
