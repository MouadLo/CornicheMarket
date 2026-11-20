import { INVALID_RECEIPT_ERROR, parseReceiptJob, type PrintJob } from "@/src/lib/print/jobs";
import type { ReceiptModel } from "@/src/lib/sales/receipt";

// The print station's work, with every side effect passed in so it can be
// tested: claim -> validate -> render -> print -> finish. One job at a time.

export type StationDeps = {
  claim: () => Promise<PrintJob | null>;
  finish: (id: string, ok: boolean, error?: string) => Promise<void>;
  print: (html: string) => Promise<void>;
  // Builds the page from a validated model, in the JOB's language.
  render: (model: ReceiptModel, job: PrintJob) => string;
};

export type StepResult =
  | { kind: "idle" }
  | { kind: "printed"; job: PrintJob }
  | { kind: "failed"; job: PrintJob; error: string };

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return (raw || "print failed").slice(0, 200);
}

// A job already claimed ("printing"): validate, print, report. A job that
// cannot be validated or printed is finished as failed; a failure to REPORT
// (network) is thrown so the caller can show "connection lost".
export async function processJob(
  job: PrintJob,
  deps: Pick<StationDeps, "finish" | "print" | "render">
): Promise<StepResult> {
  const model = parseReceiptJob(job.receipt);
  if (!model) {
    await deps.finish(job.id, false, INVALID_RECEIPT_ERROR);
    return { kind: "failed", job, error: INVALID_RECEIPT_ERROR };
  }
  try {
    await deps.print(deps.render(model, job));
  } catch (error) {
    const message = messageOf(error);
    await deps.finish(job.id, false, message);
    return { kind: "failed", job, error: message };
  }
  await deps.finish(job.id, true);
  return { kind: "printed", job };
}

export async function stationStep(deps: StationDeps): Promise<StepResult> {
  const job = await deps.claim();
  if (!job) return { kind: "idle" };
  return processJob(job, deps);
}

// Runs tasks strictly one after the other, however they are triggered (the
// loop tick, a manual "Imprimer" tap).
export function createSerialRunner() {
  let tail: Promise<unknown> = Promise.resolve();
  let running = false;
  return {
    get busy() {
      return running;
    },
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(async () => {
        running = true;
        try {
          return await task();
        } finally {
          running = false;
        }
      });
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
