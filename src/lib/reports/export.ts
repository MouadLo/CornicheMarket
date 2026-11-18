import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import Papa from "papaparse";
import { Platform } from "react-native";

import { saveTextFile } from "@/src/lib/files";

export type ReportTable = {
  title: string;
  columns: string[];
  rows: (string | number)[][];
};

// A text cell that a spreadsheet would run as a formula (=, +, -, @, or a
// leading tab/CR) gets a leading apostrophe. Product and customer names are
// user input. Genuine numbers ("-12.50") are left alone.
const NUMERIC = /^-?\d+(\.\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralizeFormula(value: string | number): string | number {
  if (typeof value === "number") return value;
  return FORMULA_START.test(value) && !NUMERIC.test(value) ? `'${value}` : value;
}

// Pure: no byte-order mark here; saveTextFile adds the single one.
export function tablesToCsv(tables: ReportTable[]): string {
  const blocks = tables.map((table) => {
    const title = Papa.unparse([[neutralizeFormula(table.title)]]);
    const body = Papa.unparse({
      fields: table.columns.map((column) => String(neutralizeFormula(column))),
      data: table.rows.map((row) => row.map(neutralizeFormula)),
    });
    return `${title}\n${body}`;
  });
  return blocks.join("\n\n");
}

export async function exportTablesAsCsv(filename: string, tables: ReportTable[]): Promise<void> {
  await saveTextFile(filename, tablesToCsv(tables));
}

function escapeHtml(value: string | number): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function tablesToHtml(
  heading: string,
  subtitle: string,
  tables: ReportTable[],
  language: string
): string {
  const dir = language === "ar" ? "rtl" : "ltr";
  const align = dir === "rtl" ? "right" : "left";
  const sections = tables
    .map(
      (table) => `
      <h2>${escapeHtml(table.title)}</h2>
      <table>
        <thead><tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
        <tbody>
          ${table.rows
            .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
            .join("")}
        </tbody>
      </table>`
    )
    .join("");

  return `<!doctype html>
<html lang="${language}" dir="${dir}">
<head><meta charset="utf-8" />
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 28px; color: #222; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }
  h2 { font-size: 15px; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: ${align}; background: #f2f5f3; padding: 7px; border-bottom: 1px solid #ddd; }
  td { text-align: ${align}; padding: 7px; border-bottom: 1px solid #eee; }
</style>
</head>
<body>
  <h1>${escapeHtml(heading)}</h1>
  <div class="subtitle">${escapeHtml(subtitle)}</div>
  ${sections}
</body>
</html>`;
}

export async function exportTablesAsPdf(
  heading: string,
  subtitle: string,
  tables: ReportTable[],
  language: string
): Promise<void> {
  const html = tablesToHtml(heading, subtitle, tables, language);

  // On web there is no file to hand back, so the browser's print dialog is
  // the route to a PDF; on a device we render one and share it.
  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return;
  }

  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: heading });
  }
}
