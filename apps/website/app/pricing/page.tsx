import type { Metadata } from "next";

import { SIGNUP_URL } from "../lib/config";

export const metadata: Metadata = {
  title: "Pricing — Schemap",
  description: "Simple, usage-based pricing for the Schemap data import layer.",
};

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "",
    tagline: "Try it on a real integration",
    cta: "Get started free",
    features: [
      "2,000 rows imported / month",
      "1 schema",
      "AI column mapping",
      "Webhook delivery + rollback",
      "Schemap badge on the widget",
    ],
  },
  {
    name: "Starter",
    price: "$29",
    period: "/mo",
    tagline: "For a live product with real customers",
    cta: "Get started",
    highlighted: true,
    features: [
      "50,000 rows imported / month",
      "5 schemas",
      "AI column mapping",
      "Webhook delivery + rollback",
      "No Schemap badge",
      "Email support",
    ],
  },
  {
    name: "Growth",
    price: "$99",
    period: "/mo",
    tagline: "For higher volume and priority delivery",
    cta: "Get started",
    features: [
      "500,000 rows imported / month",
      "Unlimited schemas",
      "AI column mapping",
      "Priority webhook delivery",
      "No Schemap badge",
      "Priority support",
    ],
  },
];

export default function PricingPage() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Simple pricing, built for indie and SMB SaaS
        </h1>
        <p className="mt-4 text-ink-soft">
          Every plan includes the full pipeline — AI mapping, validation, duplicate detection,
          webhook delivery, and rollback. Plans differ on volume and schemas, not features.
        </p>
      </div>

      <div className="mt-14 grid gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`flex flex-col rounded-2xl border p-8 ${
              plan.highlighted ? "border-brand shadow-xl shadow-brand/10" : "border-line"
            }`}
          >
            {plan.highlighted && (
              <span className="mb-4 inline-flex w-fit items-center rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
                Most popular
              </span>
            )}
            <div className="font-semibold text-ink">{plan.name}</div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-semibold text-ink">{plan.price}</span>
              {plan.period && <span className="text-sm text-ink-soft">{plan.period}</span>}
            </div>
            <p className="mt-2 text-sm text-ink-soft">{plan.tagline}</p>
            <ul className="mt-6 flex-1 space-y-3 text-sm text-ink-soft">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="mt-0.5 text-brand">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <a
              href={SIGNUP_URL}
              className={`mt-8 rounded-lg px-5 py-2.5 text-center text-sm font-semibold transition ${
                plan.highlighted
                  ? "bg-brand text-white hover:bg-brand-dark"
                  : "border border-line text-ink hover:border-ink/30"
              }`}
            >
              {plan.cta}
            </a>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-line bg-paper-dim/60 p-8 text-center">
        <div className="font-semibold text-ink">Self-hosted</div>
        <p className="mx-auto mt-2 max-w-xl text-sm text-ink-soft">
          For hospitals, fintechs, and HR platforms that legally can&apos;t send customer data to a
          third-party cloud — a <code className="font-mono">docker compose up</code> deployment,
          coming after launch.
        </p>
        <a
          href="mailto:hello@schemap.dev?subject=Self-hosted%20Schemap"
          className="mt-5 inline-block rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-ink/30"
        >
          Get in touch
        </a>
      </div>

      <p className="mt-10 text-center text-sm text-ink-soft">
        Need a different volume? <a href="mailto:hello@schemap.dev" className="font-semibold text-brand hover:text-brand-dark">Talk to us</a> — pricing scales with usage, not with how many
        engineers you have.
      </p>
    </section>
  );
}
