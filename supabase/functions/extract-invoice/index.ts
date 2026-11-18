import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import { blanksToNull, isInvoiceExtraction, normalizeInvoice, sameInvoiceHeader, validInvoiceDate } from "../_shared/invoiceParse.ts";
import { claudeExtractor, ExtractionFailure } from "./claude.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const response = (status: number, body: object) => Response.json(body, { status, headers: cors });
const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return response(405, { error: "method" });
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response(401, { error: "session" });
  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: auth, error: authError } = await caller.auth.getUser();
  if (authError || !auth.user) return response(401, { error: "session" });
  const { data: owner, error: ownerError } = await caller.rpc("is_owner");
  // A deactivated user is refused by the database's pre-request check (PT403).
  if (ownerError?.code === "PT403") return response(403, { error: "account_deactivated", code: "PT403" });
  if (owner !== true) return response(403, { error: "owner_only" });

  const draftId = (await req.json().catch(() => null))?.draft_id;
  if (typeof draftId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(draftId)) {
    return response(400, { error: "invalid_draft" });
  }
  const admin = createClient(url, serviceRole);
  const { data: claims, error: claimError } = await admin.rpc("claim_invoice_extraction", { p_draft_id: draftId });
  const claim = claims?.[0];
  if (claimError || !claim) return response(503, { error: "temporarily_unavailable" });
  if (claim.result === "ready" || claim.result === "busy") return response(200, { status: claim.result });
  if (claim.result !== "claimed") {
    return response(claim.result === "daily_limit" ? 429 : 400, { error: claim.result });
  }

  const save = (values: Record<string, unknown>) => admin.from("invoice_drafts").update(values)
    .eq("id", draftId).eq("extraction_attempt", claim.attempt).eq("status", "extracting");

  let usage: Awaited<ReturnType<ReturnType<typeof claudeExtractor>>>["usage"] | null = null;
  let extraction: unknown = null;
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) throw new ExtractionFailure("not_configured");
    const model = Deno.env.get("INVOICE_MODEL")?.trim() || "claude-opus-5-5";
    const pages = await Promise.all((claim.paths as string[]).map(async (path) => {
      const { data, error } = await admin.storage.from("invoices").download(path);
      if (error || !data) throw new ExtractionFailure("photo_unavailable");
      return encodeBase64(await data.arrayBuffer());
    }));
    const result = await claudeExtractor(key, model)(pages);
    usage = result.usage;
    extraction = blanksToNull(JSON.parse(result.text));
    if (!isInvoiceExtraction(extraction)) throw new ExtractionFailure("invalid_output");
    const { flags, totals, sourceLines } = normalizeInvoice(extraction);

    const supplierName = extraction.supplier_name?.trim().toLowerCase();
    const { data: suppliers, error: supplierError } = await admin.from("suppliers").select("id,name");
    if (supplierError) throw new ExtractionFailure("save_failed");
    const matches = suppliers.filter((supplier) => supplier.name.trim().toLowerCase() === supplierName);
    const supplier = matches.length === 1 ? matches[0].id : null;
    const number = extraction.invoice_number?.trim() || null;
    const header = { supplier_id: supplier, invoice_number: number };
    const { data: drafts, error: duplicateError } = supplier && number
      ? await admin.from("invoice_drafts").select("supplier_id,invoice_number").eq("supplier_id", supplier).neq("id", draftId)
      : { data: [], error: null };
    if (duplicateError) throw new ExtractionFailure("save_failed");
    const duplicate = drafts.some((draft) => sameInvoiceHeader(header, draft));
    const values = {
      ...header,
      invoice_date: extraction.invoice_date && validInvoiceDate(extraction.invoice_date) ? extraction.invoice_date : null,
      totals,
      source_lines: sourceLines,
      extraction,
      extraction_usage: usage,
      status: "ready",
    };

    const { error } = duplicate
      ? await save({ ...values, invoice_number: null, flags: [...flags, "duplicate_invoice"] })
      : await save({ ...values, flags });
    // A competing scan can reserve this invoice number after our lookup.
    if (error?.code === "23505") {
      const retry = await save({ ...values, invoice_number: null, flags: [...flags, "duplicate_invoice"] });
      if (retry.error) throw new ExtractionFailure("save_failed");
    } else if (error) throw new ExtractionFailure("save_failed");

    return response(200, { status: "ready" });
  } catch (error) {
    const reason = error instanceof ExtractionFailure ? error.reason : "extraction_failed";
    // Unexpected failures (an API error, unreadable output) are otherwise
    // invisible: log the error type, status and message, never invoice content.
    if (!(error instanceof ExtractionFailure)) {
      const status = (error as { status?: unknown })?.status;
      const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
      console.error("extract-invoice failed", { draft: draftId, status, name: (error as Error)?.name, message });
    }
    const { error: saveError } = await save({
      status: "failed", extraction_error: reason, extraction_usage: usage,
      extraction: isInvoiceExtraction(extraction) ? extraction : null,
    });
    return response(503, { error: saveError ? "temporarily_unavailable" : reason });
  }
});
