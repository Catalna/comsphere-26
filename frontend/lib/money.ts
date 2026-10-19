import { formatMoney } from "./formatMoney";

const SCALE = BigInt(100);
const ZERO = BigInt(0);

function toMinorUnits(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) return ZERO;
  const text = typeof value === "number" ? value.toFixed(2) : String(value).trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return ZERO;
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(2, "0"));
  return negative ? -units : units;
}

export function amountToMinorUnits(value: string | number | null | undefined): bigint {
  return toMinorUnits(value);
}

/** Exact decimal sum without floating point drift. Amounts allow at most two decimals. */
export function sumAmounts(values: Array<string | number | null | undefined>): bigint {
  return values.reduce((total, value) => total + toMinorUnits(value), ZERO);
}

/** Formats minor units (1/100) through the shared formatter. */
export function formatMinorUnits(units: bigint, currency: string): string {
  const negative = units < ZERO;
  const absolute = negative ? -units : units;
  const whole = absolute / SCALE;
  const fraction = absolute % SCALE;
  const decimal = fraction === ZERO
    ? whole.toString()
    : `${whole}.${fraction.toString().padStart(2, "0")}`;
  const formatted = formatMoney(decimal, currency);
  return negative ? `-${formatted}` : formatted;
}
