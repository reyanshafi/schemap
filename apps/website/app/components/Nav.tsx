import Link from "next/link";

import { LOGIN_URL, SIGNUP_URL } from "../lib/config";
import { Logo } from "./Logo";

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line/80 bg-paper/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium text-ink-soft sm:flex">
          <Link href="/pricing" className="transition hover:text-ink">
            Pricing
          </Link>
          <Link href="/#how-it-works" className="transition hover:text-ink">
            How it works
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <a
            href={LOGIN_URL}
            className="hidden text-sm font-medium text-ink-soft transition hover:text-ink sm:inline"
          >
            Sign in
          </a>
          <a
            href={SIGNUP_URL}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/85"
          >
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}
