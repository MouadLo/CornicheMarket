// Web camera scan filtering. Pure, so it can be tested without a camera.

// A code must have left the frame this long before it can be accepted again.
export const LEAVE_FRAME_MS = 800;

// "No misreads": a code counts only after the same value is decoded in two
// consecutive decodes. A decode that finds nothing resets the run.
export function confirmRead(
  previous: string | null,
  current: string | null
): { previous: string | null; confirmed: boolean } {
  return { previous: current, confirmed: current !== null && current === previous };
}

export type FrameGate = { code: string; lastSeenAt: number } | null;

// The same code may be accepted again only after it was not sighted for
// LEAVE_FRAME_MS. Every sighting (accepted or not) refreshes lastSeenAt, so a
// product left in front of the camera is added once. A different code is a
// different item and is accepted at once.
export function passFrameGate(
  gate: FrameGate,
  code: string,
  now: number
): { gate: FrameGate; accept: boolean } {
  const held = gate !== null && gate.code === code && now - gate.lastSeenAt < LEAVE_FRAME_MS;
  return { gate: { code, lastSeenAt: now }, accept: !held };
}

// Both rules chained. push(code, now) takes the result of one decode (null if
// nothing was found) and returns the code to hand to the app, or null.
export function createScanFilter() {
  let previous: string | null = null;
  let gate: FrameGate = null;
  return {
    push(code: string | null, now: number): string | null {
      const read = confirmRead(previous, code);
      previous = read.previous;
      if (!read.confirmed || code === null) return null;
      const result = passFrameGate(gate, code, now);
      gate = result.gate;
      return result.accept ? code : null;
    },
    reset() {
      previous = null;
      gate = null;
    },
  };
}
