import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { cleanScannedCode } from "@/src/lib/scanner/barcode";

// USB and Bluetooth barcode scanners act as keyboards: they "type" the code
// far faster than a person can and finish with Enter. We buffer keystrokes
// and only treat a burst as a scan, so ordinary typing is left alone.
const MAX_GAP_MS = 50;
const MIN_LENGTH = 4;
// Guarded mode: how long swallowed keys wait for the rest of a scan.
const HOLD_MS = 100;
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"]);

type FieldLike = { tagName?: string; value?: string; dispatchEvent?: (event: Event) => boolean };

function isField(target: unknown): target is FieldLike {
  const tag = (target as FieldLike | null)?.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA";
}

// Puts a text field back to a value in a way React-controlled inputs notice
// (assigning .value alone is swallowed by React's value tracking).
export function restoreFieldValue(field: FieldLike, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field) ?? {}, "value")?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  if (typeof Event !== "undefined") field.dispatchEvent?.(new Event("input", { bubbles: true }));
}

// guardFields: for screens with quantity boxes. A scanner types into whatever
// has focus, so with this on, a scan never reaches a text field: keys after
// the first of a burst are swallowed (capture phase), the Enter that ends a
// scan is swallowed (so it cannot submit a field or press a focused button),
// and the one digit that did land before the burst was recognised is put
// back to what the field held. Off (Sell), nothing changes: the scan passes
// through the focused field exactly as before.
export function useKeyboardWedge(
  onScan: (barcode: string) => void,
  enabled = true,
  guardFields = false
) {
  const buffer = useRef("");
  const lastKeyTime = useRef(0);
  const leaked = useRef<{ field: FieldLike; before: string } | null>(null);
  // Guarded mode only: keys swallowed because they looked like a scan. They
  // are kept here until we know. If the burst turns out to be a person typing
  // fast, they go back into the field, in order: swallowing is never losing.
  const held = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handler = useRef(onScan);

  useEffect(() => {
    handler.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (Platform.OS !== "web" || !enabled || typeof document === "undefined") return;

    const clearTimer = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    // Not a scan after all: give the held keys back to the field, and forget
    // the burst so a later Enter is not mistaken for the end of a scan.
    const flushHeld = () => {
      clearTimer();
      const text = held.current;
      const mark = leaked.current;
      held.current = "";
      buffer.current = "";
      leaked.current = null;
      if (text && mark) restoreFieldValue(mark.field, (mark.field.value ?? "") + text);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const now = Date.now();
      const gap = now - lastKeyTime.current;
      lastKeyTime.current = now;

      if (event.key === "Enter") {
        const code = buffer.current;
        const mark = leaked.current;
        if (code.length >= MIN_LENGTH) {
          clearTimer();
          held.current = "";
          buffer.current = "";
          leaked.current = null;
          event.preventDefault();
          if (guardFields) {
            event.stopPropagation();
            if (mark && (mark.field.value ?? "") !== mark.before) {
              restoreFieldValue(mark.field, mark.before);
            }
          }
          // A scanner set to a US keyboard on an AZERTY PC types "&é\"'(..."
          // for "12345...": cleaned back to digits, with stray spaces or
          // control characters removed.
          const cleaned = cleanScannedCode(code);
          if (cleaned) handler.current(cleaned);
          return;
        }
        // Too short to be a scan: whatever was held is ordinary typing.
        if (guardFields) flushHeld();
        buffer.current = "";
        leaked.current = null;
        return;
      }

      if (event.key.length !== 1) {
        // Backspace, Tab, arrows...: the held keys must be in the field before
        // this key acts on it. Bare modifiers are part of typing a scan.
        if (guardFields && !MODIFIERS.has(event.key)) flushHeld();
        return;
      }
      if (guardFields && (event.ctrlKey || event.metaKey || event.altKey)) return;

      // A slow keystroke starts a fresh buffer: it is a person typing, and
      // whatever they typed before is not part of a scan. (Guarded mode also
      // treats a held-down key as typing, never as a scan.)
      const fresh = gap > MAX_GAP_MS || (guardFields && event.repeat);
      if (fresh || buffer.current === "") {
        if (guardFields) flushHeld();
        buffer.current = event.key;
        // Remember what the focused field held before this key landed in it.
        const target = event.target;
        leaked.current =
          guardFields && isField(target) ? { field: target, before: target.value ?? "" } : null;
        return;
      }

      buffer.current += event.key;
      if (guardFields) {
        // Second key or later, arriving too fast to be a person: probably a
        // scan. Keep it out of the field, but hold it in case it is not.
        event.preventDefault();
        event.stopPropagation();
        held.current += event.key;
        clearTimer();
        timer.current = setTimeout(flushHeld, HOLD_MS);
      }
    };

    document.addEventListener("keydown", onKeyDown, guardFields);
    return () => {
      clearTimer();
      held.current = "";
      document.removeEventListener("keydown", onKeyDown, guardFields);
    };
  }, [enabled, guardFields]);
}
