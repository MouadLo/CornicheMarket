import { supabase } from "@/src/lib/supabase/client";
import type { PrintJob, PrintJobStatus, PrintLanguage } from "@/src/lib/print/jobs";
import type { ReceiptModel } from "@/src/lib/sales/receipt";

// Shared shop printer (migration 047). Phones queue jobs; the station claims
// and prints them. Status changes only go through the RPCs.

const COLUMNS =
  "id, created_by, cashier_label, receipt, language, time_zone, status, created_at, claimed_at, printed_at, error, attempts";

// The id is made by the caller once per receipt, so a retry after a lost
// response is the same insert (a duplicate id is not an error here).
export async function sendPrintJob(input: {
  id: string;
  receipt: ReceiptModel;
  cashierLabel: string;
  language: PrintLanguage;
  timeZone?: string;
}): Promise<void> {
  const { error } = await supabase.from("print_jobs").insert({
    id: input.id,
    receipt: input.receipt,
    cashier_label: input.cashierLabel,
    language: input.language,
    time_zone: input.timeZone ?? null,
  });
  // 23505: this job is already queued (an earlier attempt got through).
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function fetchPrintJob(id: string): Promise<PrintJobStatus | null> {
  const { data, error } = await supabase
    .from("print_jobs")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.status as PrintJobStatus | undefined) ?? null;
}

export async function requeuePrintJob(id: string): Promise<PrintJobStatus> {
  const { data, error } = await supabase.rpc("requeue_print_job", { p_id: id });
  if (error) throw new Error(error.message);
  return (data as PrintJob).status;
}

export async function isStationOnline(): Promise<boolean> {
  const { data, error } = await supabase.rpc("print_station_online");
  if (error) throw new Error(error.message);
  return data === true;
}

// Station only. 0 or 1 job; also the station's heartbeat.
export async function claimNextPrintJob(): Promise<PrintJob | null> {
  const { data, error } = await supabase.rpc("claim_next_print_job");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PrintJob[];
  return rows[0] ?? null;
}

export async function claimPrintJob(id: string): Promise<PrintJob> {
  const { data, error } = await supabase.rpc("claim_print_job", { p_id: id });
  if (error) throw new Error(error.message);
  return data as PrintJob;
}

export async function finishPrintJob(id: string, ok: boolean, message?: string): Promise<void> {
  const { error } = await supabase.rpc("finish_print_job", {
    p_id: id,
    p_ok: ok,
    p_error: message ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function cancelPrintJob(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_print_job", { p_id: id });
  if (error) throw new Error(error.message);
}

export async function fetchStationJobs(): Promise<PrintJob[]> {
  const { data, error } = await supabase
    .from("print_jobs")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as PrintJob[];
}
