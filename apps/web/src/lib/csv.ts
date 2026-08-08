export interface RecipientCsvRow {
  address: string;
  destAsset: string;
  amountIn: string;
}

export function parseRecipientsCsv(text: string): RecipientCsvRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith("address,"))
    .map((line, index) => {
      const [address, destAsset, amountIn] = line.split(",").map((value) => value.trim());
      if (!address || !destAsset || !amountIn) {
        throw new Error(`row ${index + 1} must have address,dest_asset,amount_in`);
      }
      return { address, destAsset, amountIn };
    });
}
