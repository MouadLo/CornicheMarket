import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  PHONE_POLL_MS,
  PHONE_TIMEOUT_MS,
  STATION_CHECK_MS,
  isPhoneFinal,
  phoneStateOf,
  type PhonePrintState,
  type PrintLanguage,
} from "@/src/lib/print/jobs";
import {
  fetchPrintJob,
  isStationOnline,
  requeuePrintJob,
  sendPrintJob,
} from "@/src/lib/print/queries";
import type { ReceiptModel } from "@/src/lib/sales/receipt";

// The phone's side of the shared printer: is the station there, send the
// receipt as a job, follow it until it is printed. It never touches the sale.
// Nothing is set after the receipt changes or the component unmounts.
export function usePhonePrint(input: {
  receipt: ReceiptModel | null;
  cashierLabel: string;
  language: PrintLanguage;
  timeZone?: string;
}) {
  const { receipt } = input;
  const [stationOnline, setStationOnline] = useState(false);
  const [state, setState] = useState<PhonePrintState>("idle");

  // One id per receipt, reused by every retry.
  const jobId = useRef<string | null>(null);
  const queued = useRef(false);
  // Bumped to cancel whatever polling is in flight.
  const epoch = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(input);
  latest.current = input;

  const stop = useCallback(() => {
    epoch.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // A new receipt (or none) starts from a clean slate.
  useEffect(() => {
    stop();
    jobId.current = null;
    queued.current = false;
    setState("idle");
    return stop;
  }, [receipt, stop]);

  // Is the station there? Now, then every 10 s while a receipt is open.
  useEffect(() => {
    if (!receipt) return;
    let alive = true;
    const check = () => {
      isStationOnline().then(
        (online) => alive && setStationOnline(online),
        () => alive && setStationOnline(false)
      );
    };
    check();
    const interval = setInterval(check, STATION_CHECK_MS);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [receipt]);

  const follow = useCallback(async (id: string) => {
    const mine = epoch.current;
    const alive = () => epoch.current === mine;
    const deadline = Date.now() + PHONE_TIMEOUT_MS;
    setState("queued");
    while (alive()) {
      await new Promise<void>((resolve) => {
        timer.current = setTimeout(resolve, PHONE_POLL_MS);
      });
      if (!alive()) return;
      try {
        const status = await fetchPrintJob(id);
        if (!alive()) return;
        if (status) {
          const next = phoneStateOf(status);
          setState(next);
          if (next === "printed") {
            // Printed: another tap is a reprint, so it gets a job of its own.
            jobId.current = null;
            queued.current = false;
          }
          if (isPhoneFinal(next)) return;
        }
      } catch {
        // A blip while polling: keep trying until the deadline.
        if (!alive()) return;
      }
      if (Date.now() >= deadline) {
        setState("timeout");
        return;
      }
    }
  }, []);

  const send = useCallback(async () => {
    const current = latest.current;
    if (!current.receipt) return;
    stop();
    const mine = epoch.current;
    jobId.current ??= Crypto.randomUUID();
    const id = jobId.current;
    setState("sending");
    try {
      if (queued.current) {
        await requeuePrintJob(id);
      } else {
        await sendPrintJob({
          id,
          receipt: current.receipt,
          cashierLabel: current.cashierLabel,
          language: current.language,
          timeZone: current.timeZone,
        });
        queued.current = true;
      }
    } catch {
      if (epoch.current === mine) setState("offline");
      return;
    }
    if (epoch.current !== mine) return;
    await follow(id);
  }, [follow, stop]);

  return {
    stationOnline,
    state,
    send,
    busy: state === "sending" || state === "queued" || state === "printing",
  };
}
