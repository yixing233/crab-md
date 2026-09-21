import "./ui.css";

export interface SpinnerProps {
  size?: number;
  /** 图标旁边的小 spinner 不需要重复朗读。 */
  label?: string;
}

export function Spinner({ size = 16, label }: SpinnerProps) {
  return (
    <span
      className="ui-spinner"
      style={{ width: size, height: size }}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
