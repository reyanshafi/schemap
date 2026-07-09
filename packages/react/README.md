# @schemap/react

The embeddable import wizard for [Schemap](https://github.com) — drop `<SchemapImporter/>`
into your app and let your users upload a CSV or Excel file, review the AI-suggested column
mapping, fix validation errors, and watch it import, without you writing any of that UI.

> Not yet published to npm — this package currently lives only inside the Schemap monorepo.

## Usage

```tsx
import { SchemapImporter } from "@schemap/react";

function ImportContactsButton() {
  const [token, setToken] = useState<string | null>(null);

  async function launch() {
    // ask YOUR backend to mint a short-lived embed token via POST /v1/embed-tokens
    const res = await fetch("/api/schemap-embed-token", { method: "POST" });
    const { token } = await res.json();
    setToken(token);
  }

  return (
    <>
      <button onClick={launch}>Import contacts</button>
      {token && (
        <SchemapImporter
          token={token}
          onComplete={(result) => console.log("imported", result)}
          onError={(err) => console.error(err)}
        />
      )}
    </>
  );
}
```

## Props

| Prop | Type | Description |
|---|---|---|
| `token` | `string` | Required. A short-lived embed JWT minted by your backend via `POST /v1/embed-tokens` — never expose your API key in the browser. |
| `apiBaseUrl` | `string` | Override the Schemap API origin (defaults to the production API; set this for self-hosted or local dev). |
| `theme` | `{ primaryColor?, borderRadius?, mode?: "light" \| "dark" }` | Basic visual theming to match your app. |
| `onComplete` | `(result) => void` | Called when the import finishes, with row counts and an error-report URL if any rows were skipped. |
| `onError` | `(error: Error) => void` | Called if the import cannot proceed (network failure, validation deadlock, etc). |

## Supported files

CSV and Excel (`.xlsx`). Workbooks with more than one sheet prompt the user to pick one before
the import starts; single-sheet workbooks and CSVs skip that step.

## Local development

From the monorepo root:

```sh
npm run build -w @schemap/react   # one-off build into dist/
npm run dev -w @schemap/react     # rebuild on save (run alongside the dashboard's dev server)
```

The dashboard consumes the built `dist/` output, so changes to this package require a rebuild
(or the watch script above) before they show up in the dashboard's test importer page.
