import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { BigButton } from "@/src/components/BigButton";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { pickTextFile } from "@/src/lib/files";
import { centsToDisplay } from "@/src/lib/money";
import {
  guessMapping,
  IMPORT_FIELDS,
  parseCsv,
  validateRows,
  type ColumnMapping,
  type ValidationResult,
} from "@/src/lib/products/csv";
import { fetchExistingBarcodes, importProducts, type ImportResult } from "@/src/lib/products/import";
import { fetchCategories, type Category } from "@/src/lib/products/queries";

type Step = "pick" | "map" | "preview" | "done";

export default function ImportProducts() {
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";

  const [step, setStep] = useState<Step>("pick");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  if (profile && !isOwner) {
    return <Redirect href="/(app)/products" />;
  }

  const handlePick = async () => {
    setError(null);
    try {
      const file = await pickTextFile();
      if (!file) return;

      const { headers: parsedHeaders, rows } = parseCsv(file.text);
      if (parsedHeaders.length === 0 || rows.length === 0) {
        setError("That file has no readable rows.");
        return;
      }

      setFileName(file.name);
      setHeaders(parsedHeaders);
      setRawRows(rows);
      setMapping(guessMapping(parsedHeaders));
      setStep("map");
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "Could not read that file.");
    }
  };

  const handleValidate = async () => {
    setBusy(true);
    setError(null);
    try {
      const existingBarcodes = await fetchExistingBarcodes();
      setValidation(validateRows(rawRows, mapping, { categories, existingBarcodes }));
      setStep("preview");
    } catch (validateError) {
      setError(validateError instanceof Error ? validateError.message : "Validation failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!validation || !profile) return;

    setBusy(true);
    setError(null);
    try {
      setResult(await importProducts(validation.rows, profile.id));
      setStep("done");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const requiredMapped = IMPORT_FIELDS.filter((field) => field.required).every(
    (field) => mapping[field.key]
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}

      {step === "pick" && (
        <>
          <Text style={styles.title}>Import products from CSV</Text>
          <Text style={styles.body}>
            Pick a .csv file. The next step lets you match its columns to product fields, and
            nothing is written until you have seen a preview.
          </Text>
          <BigButton label="Choose a CSV file" onPress={handlePick} />
        </>
      )}

      {step === "map" && (
        <>
          <Text style={styles.title}>Match the columns</Text>
          <Text style={styles.body}>
            {fileName} · {rawRows.length} rows
          </Text>

          {IMPORT_FIELDS.map((field) => (
            <View key={field.key} style={styles.field}>
              <Text style={styles.label}>
                {field.label}
                {field.required ? " *" : ""}
              </Text>
              {field.hint && <Text style={styles.hint}>{field.hint}</Text>}
              <View style={styles.chips}>
                <Chip
                  label="Ignore"
                  selected={!mapping[field.key]}
                  onPress={() =>
                    setMapping((current) => ({ ...current, [field.key]: undefined }))
                  }
                />
                {headers.map((header) => (
                  <Chip
                    key={header}
                    label={header}
                    selected={mapping[field.key] === header}
                    onPress={() =>
                      setMapping((current) => ({ ...current, [field.key]: header }))
                    }
                  />
                ))}
              </View>
            </View>
          ))}

          <BigButton
            label={busy ? "Checking..." : "Preview"}
            onPress={handleValidate}
            disabled={!requiredMapped || busy}
          />
          {!requiredMapped && (
            <Text style={styles.hint}>Name and selling price must be matched to continue.</Text>
          )}
        </>
      )}

      {step === "preview" && validation && (
        <>
          <Text style={styles.title}>Preview</Text>
          <Text style={styles.summary}>
            {validation.rows.length} row{validation.rows.length === 1 ? "" : "s"} ready ·{" "}
            {validation.errors.length} with problems
          </Text>

          {validation.rows.slice(0, 10).map((row) => (
            <View key={row.rowNumber} style={styles.previewRow}>
              <Text style={styles.previewName}>{row.product.name}</Text>
              <Text style={styles.previewMeta}>
                {centsToDisplay(row.product.selling_price_cents)} DH ·{" "}
                {row.product.barcode ?? "no barcode"} · {row.product.unit}
                {row.opening
                  ? ` · opening ${row.opening.quantity} @ ${centsToDisplay(row.opening.unit_cost_cents)} DH`
                  : ""}
              </Text>
            </View>
          ))}
          {validation.rows.length > 10 && (
            <Text style={styles.hint}>...and {validation.rows.length - 10} more.</Text>
          )}

          {validation.errors.length > 0 && (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Rows that will be skipped</Text>
              {validation.errors.slice(0, 20).map((rowError) => (
                <Text key={rowError.rowNumber} style={styles.errorLine}>
                  Row {rowError.rowNumber}: {rowError.messages.join("; ")}
                </Text>
              ))}
              {validation.errors.length > 20 && (
                <Text style={styles.errorLine}>
                  ...and {validation.errors.length - 20} more rows.
                </Text>
              )}
            </View>
          )}

          <BigButton
            label={busy ? "Importing..." : `Import ${validation.rows.length} products`}
            onPress={handleImport}
            disabled={busy || validation.rows.length === 0}
          />
          <BigButton label="Back to mapping" variant="secondary" onPress={() => setStep("map")} />
        </>
      )}

      {step === "done" && result && (
        <>
          <Text style={styles.title}>Import finished</Text>
          <Text style={styles.summary}>
            {result.inserted} product{result.inserted === 1 ? "" : "s"} created
            {result.openingLines > 0
              ? `, opening stock recorded for ${result.openingLines}`
              : ""}
            .
          </Text>

          {result.errors.length > 0 && (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Problems</Text>
              {result.errors.slice(0, 20).map((rowError, index) => (
                <Text key={`${rowError.rowNumber}-${index}`} style={styles.errorLine}>
                  {rowError.rowNumber > 0 ? `Row ${rowError.rowNumber}: ` : ""}
                  {rowError.messages.join("; ")}
                </Text>
              ))}
            </View>
          )}

          <BigButton label="Back to products" onPress={() => router.replace("/(app)/products")} />
        </>
      )}
    </ScrollView>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: "700" },
  body: { fontSize: 15, color: "#555", lineHeight: 21 },
  summary: { fontSize: 16, fontWeight: "600" },
  field: { gap: 6 },
  label: { fontSize: 15, fontWeight: "600" },
  hint: { fontSize: 13, color: "#777" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, backgroundColor: "#eee" },
  chipSelected: { backgroundColor: "#1d7a46" },
  chipText: { fontSize: 14, color: "#333" },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  previewRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  previewName: { fontSize: 15, fontWeight: "600" },
  previewMeta: { fontSize: 13, color: "#666" },
  errorBox: { backgroundColor: "#fdecea", borderRadius: 10, padding: 12, gap: 4 },
  errorTitle: { fontWeight: "700", color: "#b3261e" },
  errorLine: { fontSize: 13, color: "#8c1d18" },
  error: { color: "#b3261e", fontSize: 15 },
});
