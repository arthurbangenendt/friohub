import type { CSSProperties } from "react";

export function Field({
  label,
  name,
  type = "text",
  placeholder,
  autoComplete,
  required = true,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label style={fieldWrap}>
      <span style={labelStyle}>{label}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        style={input}
      />
    </label>
  );
}

export const fieldWrap: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginBottom: 16,
};
export const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--ink-soft)",
};
export const input: CSSProperties = {
  height: 44,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontSize: 15,
  outlineColor: "var(--cool)",
};
export const primaryBtn: CSSProperties = {
  height: 46,
  width: "100%",
  border: "none",
  borderRadius: 10,
  background: "var(--cool)",
  color: "#fff",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
  marginTop: 4,
};
