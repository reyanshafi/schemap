import type { ReactElement } from "react";

export interface SchemapTheme {
  primaryColor?: string;
  borderRadius?: string;
  logoUrl?: string;
  mode?: "light" | "dark";
}

export interface ImportResult {
  importId: string;
  imported: number;
  skipped: number;
  failed: number;
  errorReportUrl?: string;
}

export interface SchemapImporterProps {
  /** short-lived embed token minted by the host backend via POST /v1/embed-tokens */
  token: string;
  /** target schema key, e.g. "contacts" */
  schema: string;
  /** override for self-hosted / staging; defaults to Schemap cloud */
  apiBaseUrl?: string;
  theme?: SchemapTheme;
  onComplete?: (result: ImportResult) => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
}

/**
 * The full import wizard: upload → AI mapping review → validation → progress → summary.
 * Placeholder until Phase 7 — real UI is built after the APIs it drives exist.
 */
export function SchemapImporter(props: SchemapImporterProps): ReactElement {
  return (
    <div data-schemap-importer data-schema={props.schema}>
      Schemap importer (UI arrives in Phase 7)
    </div>
  );
}
