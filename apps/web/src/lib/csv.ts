import { MAX_BATCH_RECIPIENTS } from "@stellar-flowroute/sdk";
import { parseAmountIn, validateDestinationAsset, validateRecipientAddress } from "@/lib/batch";

export interface RecipientCsvRow {
  address: string;
  destAsset: string;
  amountIn: string;
}

// The contract rejects a batch with more than MAX_BATCH_RECIPIENTS recipients, so an oversized CSV never becomes a
// payout batch. Addresses, assets, and amounts are checked here too, before any quoting or simulation.
export function parseRecipientsCsv(text: string): RecipientCsvRow[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith("address,"))
    .map((line, index) => {
      const [address, destAsset, amountIn] = line.split(",").map((value) => value.trim());
      if (!address || !destAsset || !amountIn) {
        throw new Error(`row ${index + 1} must have address,dest_asset,amount_in`);
      }

      try {
        validateRecipientAddress(address);
        validateDestinationAsset(destAsset);
        parseAmountIn(amountIn);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "invalid value";
        throw new Error(`row ${index + 1}: ${reason}`);
      }

      return { address, destAsset, amountIn };
    });

  if (rows.length > MAX_BATCH_RECIPIENTS) {
    throw new Error(
      `a payout batch can hold at most ${MAX_BATCH_RECIPIENTS} recipients, this CSV has ${rows.length}`,
    );
  }

  return rows;
}
