"use client";

import { useCallback, useEffect, useState } from "react";
import { connectWallet, isFreighterAvailable } from "@/lib/wallet";
import { truncateAddress } from "@/lib/format";

interface ConnectWalletButtonProps {
  onConnect?: (address: string) => void;
}

export function ConnectWalletButton({ onConnect }: ConnectWalletButtonProps) {
  const [address, setAddress] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    isFreighterAvailable()
      .then(setAvailable)
      .catch(() => setAvailable(false));
  }, []);

  const handleConnect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const connectedAddress = await connectWallet();
      setAddress(connectedAddress);
      onConnect?.(connectedAddress);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }, [onConnect]);

  if (address) {
    return (
      <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]">
        {truncateAddress(address)}
      </span>
    );
  }

  if (available === false) {
    return (
      <a
        href="https://www.freighter.app/"
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        Install Freighter
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={handleConnect}
      disabled={connecting}
      className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[#0b0f14] disabled:opacity-60"
    >
      {connecting ? "Connecting..." : "Connect Wallet"}
      {error ? <span className="ml-2 text-red-600">{error}</span> : null}
    </button>
  );
}
