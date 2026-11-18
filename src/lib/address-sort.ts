const addressOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const letters: Record<string, string> = { А: "A", В: "B", С: "C", Е: "E", Н: "H", К: "K", М: "M", О: "O", Р: "P", Т: "T", Х: "X", У: "Y" };
function firstAddress(value?: string | null) {
  return (value || "").trim().toUpperCase().replace(/[АВСЕНКМОРТХУ]/g, letter => letters[letter])
    .split(/\s+/).filter(Boolean).sort(addressOrder.compare)[0] || "";
}
export function compareAddresses(a?: string | null, b?: string | null) {
  const left = firstAddress(a), right = firstAddress(b);
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  return addressOrder.compare(left, right);
}
