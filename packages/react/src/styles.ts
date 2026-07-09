import type { CSSProperties } from "react";

export interface SchemapTheme {
  primaryColor?: string;
  borderRadius?: string;
  mode?: "light" | "dark";
  logoUrl?: string;
}

export interface Styles {
  container: CSSProperties;
  card: CSSProperties;
  h: CSSProperties;
  muted: CSSProperties;
  error: CSSProperties;
  button: CSSProperties;
  buttonGhost: CSSProperties;
  table: CSSProperties;
  th: CSSProperties;
  td: CSSProperties;
  input: CSSProperties;
  select: CSSProperties;
  dropzone: CSSProperties;
  progressOuter: CSSProperties;
  progressInner: (pct: number) => CSSProperties;
  badge: (confidence: number) => CSSProperties;
}

export function buildStyles(theme: SchemapTheme = {}): Styles {
  const dark = theme.mode === "dark";
  const primary = theme.primaryColor ?? "#4f46e5";
  const radius = theme.borderRadius ?? "8px";
  const fg = dark ? "#e5e5e5" : "#1a1a1a";
  const bg = dark ? "#171717" : "#ffffff";
  const border = dark ? "#333" : "#e2e2e2";
  const mutedFg = dark ? "#999" : "#666";

  const badgeBase: CSSProperties = {
    display: "inline-block",
    padding: "0.1rem 0.5rem",
    borderRadius: 999,
    fontSize: "0.75rem",
    fontWeight: 600,
  };

  return {
    container: { fontFamily: "system-ui, sans-serif", color: fg, background: bg, maxWidth: 760 },
    card: { border: `1px solid ${border}`, borderRadius: radius, padding: "1.25rem", background: bg },
    h: { margin: "0 0 0.75rem", fontSize: "1.1rem" },
    muted: { color: mutedFg, fontSize: "0.85rem" },
    error: { color: "#dc2626", margin: "0.5rem 0" },
    button: {
      padding: "0.5rem 1.1rem",
      border: "none",
      borderRadius: radius,
      background: primary,
      color: "#fff",
      font: "inherit",
      fontWeight: 600,
      cursor: "pointer",
    },
    buttonGhost: {
      padding: "0.35rem 0.8rem",
      border: `1px solid ${border}`,
      borderRadius: radius,
      background: "transparent",
      color: fg,
      font: "inherit",
      cursor: "pointer",
    },
    table: { width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" },
    th: { textAlign: "left", padding: "0.45rem", borderBottom: `2px solid ${border}`, color: mutedFg, fontSize: "0.8rem" },
    td: { padding: "0.45rem", borderBottom: `1px solid ${border}`, verticalAlign: "top" },
    input: {
      width: "100%",
      boxSizing: "border-box",
      padding: "0.3rem 0.4rem",
      border: `1px solid ${border}`,
      borderRadius: 6,
      font: "inherit",
      fontSize: "0.85rem",
      background: bg,
      color: fg,
    },
    select: {
      padding: "0.3rem 0.4rem",
      border: `1px solid ${border}`,
      borderRadius: 6,
      font: "inherit",
      fontSize: "0.85rem",
      background: bg,
      color: fg,
      maxWidth: 200,
    },
    dropzone: {
      border: `2px dashed ${border}`,
      borderRadius: radius,
      padding: "3rem 1rem",
      textAlign: "center",
      cursor: "pointer",
    },
    progressOuter: {
      height: 10,
      borderRadius: 999,
      background: dark ? "#333" : "#eee",
      overflow: "hidden",
      margin: "0.75rem 0",
    },
    progressInner: (pct) => ({
      height: "100%",
      width: `${Math.min(100, Math.max(0, pct))}%`,
      background: primary,
      transition: "width 0.4s",
    }),
    badge: (confidence) => ({
      ...badgeBase,
      background: confidence >= 0.9 ? "#dcfce7" : confidence >= 0.6 ? "#fef9c3" : "#fee2e2",
      color: confidence >= 0.9 ? "#166534" : confidence >= 0.6 ? "#854d0e" : "#991b1b",
    }),
  };
}
