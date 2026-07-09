import Link from "next/link";

import { CodeBlock } from "./components/CodeBlock";
import { SIGNUP_URL } from "./lib/config";

const PIPELINE = [
  {
    step: "01",
    title: "Upload",
    body: "Your user drops in a CSV or Excel file. Streamed straight to storage — no size surprises, even at 100MB.",
  },
  {
    step: "02",
    title: "AI mapping",
    body: "Claude reads the headers and sample values, matches them to your schema, and scores its own confidence.",
  },
  {
    step: "03",
    title: "Review & validate",
    body: "Your user confirms the mapping, fixes flagged rows inline, and duplicates get caught automatically.",
  },
  {
    step: "04",
    title: "Deliver & rollback",
    body: "Clean rows land in your backend via signed webhooks, in order, with retries — and a rollback path if anything fails.",
  },
];

const FEATURES = [
  {
    title: "AI-native mapping",
    body: "Column matching, transform suggestions, and fix suggestions are LLM-powered from day one — not fuzzy string matching wearing an AI label.",
  },
  {
    title: "Built for messy reality",
    body: "Delimiter sniffing, encoding quirks, DD/MM vs MM/DD dates, phone numbers missing a country code — handled before your code ever sees a row.",
  },
  {
    title: "Streaming, always",
    body: "Files are parsed in constant memory. A 250,000-row import behaves the same as a 10-row one.",
  },
  {
    title: "Duplicate detection",
    body: "Unique-field collisions are caught inside the file automatically, with a policy you choose: keep first, keep last, or exclude both.",
  },
  {
    title: "Webhooks with a rollback path",
    body: "Signed, ordered, retried batch delivery — and if something fails partway through, Schemap tells your backend exactly what to undo.",
  },
  {
    title: "Themable, embeddable widget",
    body: "One React component, styled to match your product. Your users never know they left your app.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-grid relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-paper via-paper/95 to-paper" />
        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-20 sm:pt-28">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center rounded-full border border-line bg-paper-dim px-3 py-1 text-xs font-medium text-ink-soft">
              AI-powered CSV &amp; Excel imports
            </span>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-ink sm:text-6xl">
              Data import,
              <br className="hidden sm:block" /> without the two-month build.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-soft">
              Stripe made payments a 10-line integration. Schemap makes importing your customers&apos;
              messy spreadsheets one, too — AI column mapping, validation, and delivery, dropped
              straight into your product.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href={SIGNUP_URL}
                className="w-full rounded-lg bg-brand px-6 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-dark sm:w-auto"
              >
                Get started free
              </a>
              <Link
                href="/pricing"
                className="w-full rounded-lg border border-line bg-paper px-6 py-3 text-center text-sm font-semibold text-ink transition hover:border-ink/30 sm:w-auto"
              >
                See pricing
              </Link>
            </div>
          </div>

          <div className="mx-auto mt-16 max-w-2xl">
            <CodeBlock
              title="ContactsImportButton.tsx"
              code={`import { SchemapImporter } from "@schemap/react";

<SchemapImporter
  token={embedToken}
  onComplete={(result) => refreshContacts()}
/>`}
            />
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="border-t border-line bg-paper-dim/60 py-20">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Every SaaS gets asked the same question.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-ink-soft">
            &ldquo;Can I import my existing data?&rdquo; Every customer&apos;s file looks different —{" "}
            <em>Name / Email / Phone</em> vs. <em>Customer Name / Mobile Number / Email Address</em>{" "}
            vs. a raw export from whatever they used before you. Most teams spend two months
            building an importer out of hardcoded column-name conditions. It still breaks on the
            next customer&apos;s file.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-ink-soft">
            The column mapping is maybe 20% of the pain. The other 80% is the pipeline nobody wants
            to build: streaming large files, validation, duplicate detection, background jobs with
            progress, human-readable error reports, and rollback when row 48,000 of 50,000 fails.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-16 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              One pipeline, built once
            </h2>
            <p className="mt-4 text-ink-soft">
              Every import runs the same reliable path — you just define the schema and hand off a
              token.
            </p>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PIPELINE.map((p) => (
              <div key={p.step} className="rounded-xl border border-line bg-paper p-6">
                <div className="text-xs font-semibold text-brand">{p.step}</div>
                <div className="mt-3 font-semibold text-ink">{p.title}</div>
                <p className="mt-2 text-sm text-ink-soft">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-line bg-paper-dim/60 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Everything an importer needs, none of it built by you
            </h2>
          </div>
          <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <div className="font-semibold text-ink">{f.title}</div>
                <p className="mt-2 text-sm text-ink-soft">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing preview */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Priced for indie and SMB SaaS
            </h2>
            <p className="mt-4 text-ink-soft">
              A generous free tier, and plans a bootstrapped founder can actually afford.
            </p>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-3">
            {[
              { name: "Free", price: "$0", detail: "2,000 rows/mo · 1 schema" },
              { name: "Starter", price: "$29/mo", detail: "50,000 rows/mo · 5 schemas" },
              { name: "Growth", price: "$99/mo", detail: "500,000 rows/mo · unlimited schemas" },
            ].map((tier) => (
              <div key={tier.name} className="rounded-xl border border-line bg-paper p-6 text-center">
                <div className="font-semibold text-ink">{tier.name}</div>
                <div className="mt-2 text-2xl font-semibold text-ink">{tier.price}</div>
                <div className="mt-2 text-sm text-ink-soft">{tier.detail}</div>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/pricing" className="text-sm font-semibold text-brand hover:text-brand-dark">
              Compare all plans →
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-line bg-ink py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Stop building importers. Start shipping them.
          </h2>
          <p className="mt-4 text-white/70">
            Working import flow in under 30 minutes — schema, API key, one component.
          </p>
          <a
            href={SIGNUP_URL}
            className="mt-8 inline-block rounded-lg bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:bg-white/90"
          >
            Get started free
          </a>
        </div>
      </section>
    </>
  );
}
