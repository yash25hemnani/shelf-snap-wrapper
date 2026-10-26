/** Converts an ISBN-10 to ISBN-13; ISBN-13s pass through. Digits only in. */
export function toIsbn13(isbn: string): string {
  if (isbn.length === 13) return isbn;
  const digits = `978${isbn.slice(0, 9)}`;
  const sum = [...digits].reduce(
    (acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3),
    0,
  );
  return `${digits}${(10 - (sum % 10)) % 10}`;
}
