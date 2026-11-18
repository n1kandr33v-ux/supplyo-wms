// Decode physical scanner keys as US English only in scan fields.
const ru = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const en = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
export function normalizeScannerText(value: string): string {
  if (!/[а-яё]/i.test(value)) return value;
  const punctuation: Record<string, string> = {'"':'@', '№':'#', ';':'$', ':':'^', '?':'&', '.':'/', ',':'?'};
  return Array.from(value, char => {
    const index = ru.indexOf(char.toLowerCase());
    if (index < 0) return punctuation[char] ?? char;
    const english = en[index];
    if (char === char.toLowerCase()) return english;
    return ({'[':'{', ']':'}', ';':':', "'":'"', ',':'<', '.':'>', '`':'~'} as Record<string,string>)[english] ?? english.toUpperCase();
  }).join('');
}
type ScanKey = {key:string; code:string; shiftKey:boolean; ctrlKey:boolean; altKey:boolean; metaKey:boolean; isComposing?:boolean};
export function scannerKey(event: ScanKey): string | null {
  if (event.isComposing || event.altKey || event.metaKey) return null;
  if (event.key === 'F8' || (event.ctrlKey && event.code === 'BracketRight')) return '\u001d';
  if (event.ctrlKey || event.key.length !== 1) return null;
  if (/^Key[A-Z]$/.test(event.code)) return /^[a-z]$/i.test(event.key) ? event.key : event.shiftKey ? event.code.slice(3) : event.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(event.code)) {
    const digit = event.code.slice(5), shifted = ')!@#$%^&*('[Number(digit)];
    return event.key === digit || event.key === shifted ? event.key : event.shiftKey ? shifted : digit;
  }
  const pairs: Record<string,string> = {Backquote:'`~', Minus:'-_', Equal:'=+', BracketLeft:'[{', BracketRight:']}', Backslash:'\\|', Semicolon:';:', Quote:"'\"", Comma:',<', Period:'.>', Slash:'/?', Space:'  ', NumpadDecimal:'..'};
  if (pairs[event.code]) return pairs[event.code].includes(event.key) ? event.key : pairs[event.code][event.shiftKey ? 1 : 0];
  return normalizeScannerText(event.key);
}
export function insertScanText(value: string, start: number | null, end: number | null, text: string): string {
  return value.slice(0, start ?? value.length) + text + value.slice(end ?? value.length);
}
