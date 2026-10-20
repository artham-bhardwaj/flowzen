/** Parses a number written the way people write estimates: "3.3 million", "38", "2k", "1,500". */
export function parseNumber(text: string | undefined): number | null {
  if (!text) return null;
  const match = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([kmbt]|thousand|million|billion|trillion)?\b/i.exec(text.replace(/(\d),(?=\d{3}\b)/g, '$1'));
  if (!match) return null;
  const scale: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 };
  const value = Number(match[1]) * (match[2] ? scale[match[2].toLowerCase()] : 1);
  return Number.isFinite(value) ? value : null;
}
