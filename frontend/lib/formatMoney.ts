export function formatMoney(amount: string, currency: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  const groupedWhole = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(BigInt(whole));
  const normalizedFraction = fraction.replace(/0+$/, "");
  const localizedFraction = normalizedFraction ? `,${normalizedFraction}` : "";
  const symbol = currency === "IDR" ? "Rp" : currency;
  return `${symbol} ${groupedWhole}${localizedFraction}`;
}
