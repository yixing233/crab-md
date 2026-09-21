import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import "./ui.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** 辅助说明；与 error 互斥显示。 */
  hint?: string;
  error?: string;
}

/**
 * 带标签的输入框。标签始终可见 —— 占位符不得作为唯一标签
 * （UI_DESIGN_SYSTEM.md §15）。
 */
export function Input({ label, hint, error, id, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="ui-input"
        data-invalid={error ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {error ? (
        <p className="ui-field__error" id={`${inputId}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="ui-field__hint" id={`${inputId}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
