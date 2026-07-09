import type { CSSProperties } from "react";

// tiny shared style kit — replaced by a real design system later
export const ui = {
  page: { maxWidth: 880, margin: "0 auto", padding: "2rem 1rem" } as CSSProperties,
  card: {
    border: "1px solid #e2e2e2",
    borderRadius: 8,
    padding: "1.25rem",
    marginBottom: "1rem",
    background: "#fff",
  } as CSSProperties,
  input: {
    display: "block",
    width: "100%",
    padding: "0.5rem 0.6rem",
    margin: "0.25rem 0 0.75rem",
    border: "1px solid #ccc",
    borderRadius: 6,
    font: "inherit",
    boxSizing: "border-box",
  } as CSSProperties,
  button: {
    padding: "0.5rem 1rem",
    border: "none",
    borderRadius: 6,
    background: "#1a1a2e",
    color: "#fff",
    font: "inherit",
    cursor: "pointer",
  } as CSSProperties,
  buttonGhost: {
    padding: "0.35rem 0.75rem",
    border: "1px solid #ccc",
    borderRadius: 6,
    background: "transparent",
    color: "#333",
    font: "inherit",
    cursor: "pointer",
  } as CSSProperties,
  error: { color: "#c0392b", margin: "0.5rem 0" } as CSSProperties,
  table: { width: "100%", borderCollapse: "collapse" } as CSSProperties,
  th: {
    textAlign: "left",
    padding: "0.5rem",
    borderBottom: "2px solid #eee",
    fontSize: "0.85rem",
    color: "#666",
  } as CSSProperties,
  td: { padding: "0.5rem", borderBottom: "1px solid #f0f0f0" } as CSSProperties,
  mono: { fontFamily: "ui-monospace, monospace", fontSize: "0.85rem" } as CSSProperties,
};
