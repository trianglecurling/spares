export function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/** Excel-friendly CSV: UTF-8 BOM and CRLF line endings. */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((line) => line.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
