import Link from "next/link";

import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-ink-soft">
              The embeddable, AI-powered data import layer for SaaS products.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 text-sm">
            <div>
              <div className="font-semibold text-ink">Product</div>
              <ul className="mt-3 space-y-2 text-ink-soft">
                <li>
                  <Link href="/pricing" className="hover:text-ink">
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link href="/#how-it-works" className="hover:text-ink">
                    How it works
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <div className="font-semibold text-ink">Company</div>
              <ul className="mt-3 space-y-2 text-ink-soft">
                <li>
                  <a href="mailto:hello@schemap.dev" className="hover:text-ink">
                    Contact
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-10 border-t border-line pt-6 text-xs text-ink-soft">
          © {new Date().getFullYear()} Schemap. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
