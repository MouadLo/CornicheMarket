import { useCallback, useEffect, useRef, useState } from "react";

import type { PrintJob } from "@/src/lib/print/jobs";
import {
  cancelPrintJob,
  claimNextPrintJob,
  claimPrintJob,
  fetchStationJobs,
  finishPrintJob,
} from "@/src/lib/print/queries";
import {
  createSerialRunner,
  processJob,
  stationStep,
  type StationDeps,
} from "@/src/lib/print/station";
import type { ReceiptModel } from "@/src/lib/sales/receipt";
import { printReceipt } from "@/src/lib/sales/printReceipt";

export const STATION_POLL_MS = 1500;
export const STATION_LIST_MS = 5000;
const BETWEEN_JOBS_MS = 200;

// The station's loop. While mounted and enabled it claims one job at a time
// (this also tells the phones the station is there), prints it and reports.
// The next claim only starts after the previous job is fully handled, and a
// manual "Imprimer" runs through the same one-at-a-time runner.
export function usePrintStation(input: {
  enabled: boolean;
  render: (model: ReceiptModel, job: PrintJob) => string;
}) {
  const { enabled } = input;
  const [connected, setConnected] = useState(true);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [actionFailed, setActionFailed] = useState(false);
  const runner = useRef(createSerialRunner());
  const renderRef = useRef(input.render);
  renderRef.current = input.render;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const deps = useRef<StationDeps>({
    claim: claimNextPrintJob,
    finish: finishPrintJob,
    print: printReceipt,
    render: (model, job) => renderRef.current(model, job),
  });

  const refresh = useCallback(async () => {
    try {
      const list = await fetchStationJobs();
      if (alive.current) setJobs(list);
    } catch {
      // The loop reports a lost connection; the list just keeps what it had.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      let delay = STATION_POLL_MS;
      try {
        const result = await runner.current.run(() => stationStep(deps.current));
        if (stopped) return;
        setConnected(true);
        if (result.kind !== "idle") {
          delay = BETWEEN_JOBS_MS;
          void refresh();
        }
      } catch {
        if (stopped) return;
        setConnected(false);
      }
      if (!stopped) timer = setTimeout(tick, delay);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const interval = setInterval(refresh, STATION_LIST_MS);
    return () => clearInterval(interval);
  }, [enabled, refresh]);

  const printNow = useCallback(
    async (job: PrintJob) => {
      setActionFailed(false);
      try {
        await runner.current.run(async () => {
          const claimed = await claimPrintJob(job.id);
          return processJob(claimed, deps.current);
        });
      } catch {
        if (alive.current) setActionFailed(true);
      }
      await refresh();
    },
    [refresh]
  );

  const ignore = useCallback(
    async (job: PrintJob) => {
      setActionFailed(false);
      try {
        await cancelPrintJob(job.id);
      } catch {
        if (alive.current) setActionFailed(true);
      }
      await refresh();
    },
    [refresh]
  );

  return { connected, jobs, actionFailed, printNow, ignore };
}
