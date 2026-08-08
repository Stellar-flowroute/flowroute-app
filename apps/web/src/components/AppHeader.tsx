import Link from "next/link";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

export function AppHeader() {
  return (
    <header className="border-b border-[var(--color-border)]">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          FlowRoute
        </Link>
        <nav className="flex items-center gap-6 text-sm text-[var(--color-text-muted)]">
          <Link href="/payout" className="hover:text-[var(--color-text)]">
            New payout
          </Link>
          <Link href="/history" className="hover:text-[var(--color-text)]">
            History
          </Link>
        </nav>
        <ConnectWalletButton />
      </div>
    </header>
  );
}
