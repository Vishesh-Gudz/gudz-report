/**
 * EAN validity, used to tell a real barcode from a placeholder.
 *
 * The real Blinkit sheet carries `8910000000000` in its `UPC` column on 107
 * rows spread across twelve different products. It is a filler, not a barcode —
 * one product cannot be twelve — and taking it at face value did two bad things
 * at once: it stopped those rows from being resolved through the `Master` sheet,
 * which would have found their real EAN, and it collapsed twelve products onto
 * one meaningless key.
 *
 * A check digit is the principled way to catch it rather than a hard-coded list
 * of known junk values. Every genuine Healthy Master EAN in the workbook passes;
 * `8910000000000` fails. The next placeholder somebody invents will fail too.
 */

/** Whether a string is a checksum-valid EAN-13, UPC-A or EAN-8. */
export function isValidEan(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const digits = value.trim();
  if (!/^\d+$/.test(digits)) return false;
  if (digits.length !== 8 && digits.length !== 12 && digits.length !== 13) {
    return false;
  }

  // Weights alternate 3 and 1 from the right, ending at the check digit.
  let total = 0;
  for (let index = digits.length - 2; index >= 0; index -= 1) {
    const digit = Number(digits[index]);
    const positionFromRight = digits.length - 1 - index;
    total += digit * (positionFromRight % 2 === 1 ? 3 : 1);
  }

  const expected = (10 - (total % 10)) % 10;
  return expected === Number(digits[digits.length - 1]);
}
