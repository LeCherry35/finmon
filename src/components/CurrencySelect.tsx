import { CURRENCIES, type Currency } from "@/lib/currencies";

/** The currency the amount next to it is entered in; the server converts
 *  USD/EUR to UAH. */
export default function CurrencySelect({
  defaultValue = "UAH",
  className = "",
}: {
  defaultValue?: Currency;
  className?: string;
}) {
  return (
    <select name="currency" aria-label="Currency" defaultValue={defaultValue} className={className}>
      {CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
