import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">FlowRoute</h1>
      <p className="max-w-xl text-[var(--color-text-muted)]">
        Fund one payout run in a single source asset. FlowRoute swaps into each recipient&apos;s chosen
        destination asset through Soroswap and enforces a per recipient minimum received, so slippage never
        costs a recipient more than you allowed.
      </p>
      <div className="flex gap-4">
        <Link
          href="/payout"
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[#0b0f14]"
        >
          Start a payout
        </Link>
        <Link
          href="/history"
          className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
        >
          View settlement history
        </Link>
      </div>
    </div>
  );
}
