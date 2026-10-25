import { useEffect, useRef } from "react";
import { Platform } from "react-native";

// USB and Bluetooth barcode scanners act as keyboards: they "type" the code
// far faster than a person can and finish with Enter. We buffer keystrokes
// and only treat a burst as a scan, so ordinary typing is left alone.
const MAX_GAP_MS = 50;
const MIN_LENGTH = 4;

export function useKeyboardWedge(onScan: (barcode: string) => void, enabled = true) {
  const buffer = useRef("");
  const lastKeyTime = useRef(0);
  const handler = useRef(onScan);

  useEffect(() => {
    handler.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (Platform.OS !== "web" || !enabled || typeof document === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      const now = Date.now();
      const gap = now - lastKeyTime.current;
      lastKeyTime.current = now;

      if (event.key === "Enter") {
        const code = buffer.current;
        buffer.current = "";
        if (code.length >= MIN_LENGTH) {
          event.preventDefault();
          handler.current(code);
        }
        return;
      }

      if (event.key.length !== 1) return;

      // A slow keystroke starts a fresh buffer: it is a person typing, and
      // whatever they typed before is not part of a scan.
      buffer.current = gap > MAX_GAP_MS ? event.key : buffer.current + event.key;
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
