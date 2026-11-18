// Web camera scan filtering. Pure, so it can be tested without a camera.

// A code must have left the frame this long before it can be accepted again.
export const LEAVE_FRAME_MS = 1500;

// "No misreads": a code counts only after the same value is decoded in two
// consecutive decodes. A decode that finds nothing resets the run.
export function confirmRead(
  previous: string | null,
  current: string | null
): { previous: string | null; confirmed: boolean } {
  return { previous: current, confirmed: current !== null && current === previous };
}

// Both rules chained. push(code, now) takes the result of one decode (null if
// nothing was found) and returns the code to hand to the app, or null.
//
// An accepted code is remembered until it has gone unsighted for LEAVE_FRAME_MS.
// EVERY sighting refreshes it, confirmed or not: a phone camera often reads a
// held barcode only every other frame, and that must not count as leaving. Codes
// are remembered separately, so two barcodes in view cannot re-add each other.
export function createScanFilter() {
  let previous: string | null = null;
  const held = new Map<string, number>();
  return {
    push(code: string | null, now: number): string | null {
      for (const [known, seenAt] of held) {
        if (now - seenAt >= LEAVE_FRAME_MS) held.delete(known);
      }
      const read = confirmRead(previous, code);
      previous = read.previous;
      if (code === null) return null;
      if (held.has(code)) {
        held.set(code, now);
        return null;
      }
      if (!read.confirmed) return null;
      held.set(code, now);
      return code;
    },
    reset() {
      previous = null;
      held.clear();
    },
  };
}
