import type { ReactNode } from "react";
import { Icon } from "../ui";

// Small presentational primitives for the Settings modal, split out of
// SettingsModal so the shell + tabs read as layout rather than widget markup.

export function modelLabel(id: string): string {
  return id
    .replace(/^gpt-/, "GPT ")
    .replace(/^claude-/, "Claude ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Gpt", "GPT");
}

export function SettingRow({
  title,
  sub,
  subTitle,
  onSubClick,
  children,
}: {
  title: string;
  sub: string;
  subTitle?: string;
  onSubClick?: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-title">{title}</div>
        <div
          className={`settings-row-sub ${onSubClick ? "clickable" : ""}`}
          title={subTitle}
          onClick={onSubClick}
        >
          {sub}
        </div>
      </div>
      {children}
    </div>
  );
}

export function Divider(): JSX.Element {
  return <div className="settings-divider" />;
}

export function SettingSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}): JSX.Element {
  return (
    <span className={`settings-select-btn ${disabled ? "disabled" : ""}`}>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-top" size={16} style={{ transform: "rotate(180deg)" }} />
    </span>
  );
}
