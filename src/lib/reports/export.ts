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

export async function exportTablesAsCsv(
  filename: string,
  tables: ReportTable[]
): Promise<void> {
  const blocks = tables.map((table) => {
    const body = Papa.unparse({ fields: table.columns, data: table.rows });
    return `${table.title}\n${body}`;
  });

  await saveTextFile(filename, blocks.join("\n\n"));
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tablesToHtml(heading: string, subtitle: string, tables: ReportTable[]): string {
  const sections = tables
    .map(
      (table) => `
      <h2>${escapeHtml(table.title)}</h2>
      <table>
        <thead><tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
        <tbody>
          ${table.rows
            .map(
              (row) =>
                `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
            )
            .join("")}
        </tbody>
      </table>`
    )
    .join("");

  return `<!doctype html>
<html>
<head><meta charset="utf-8" />
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 28px; color: #222; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }
  h2 { font-size: 15px; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; background: #f2f5f3; padding: 7px; border-bottom: 1px solid #ddd; }
  td { padding: 7px; border-bottom: 1px solid #eee; }
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
  tables: ReportTable[]
): Promise<void> {
  const html = tablesToHtml(heading, subtitle, tables);

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
