// Owns the camera stream so it is always released: every track is stopped on
// stop(), and a start that resolves after stop() (modal closed meanwhile)
// stops its own tracks instead of leaving the camera on.

export type StreamLike = { getTracks: () => { stop: () => void }[] };

export function stopStream(stream: StreamLike | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

export type CameraErrorKind = "denied" | "notFound" | "inUse" | "insecure" | "generic";

export function classifyCameraError(
  error: unknown,
  env: { hasGetUserMedia: boolean; secureContext: boolean }
): CameraErrorKind {
  if (!env.secureContext) return "insecure";
  if (!env.hasGetUserMedia) return "notFound";
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "denied";
  }
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError"
  ) {
    return "notFound";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return "inUse";
  }
  return "generic";
}

// Rear camera, enough resolution for retail barcodes.
export const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
} as const;

export function createCameraController<S extends StreamLike>(getStream: () => Promise<S>) {
  let generation = 0;
  let current: S | null = null;
  return {
    // Resolves null when stop() (or a newer start()) happened meanwhile.
    async start(): Promise<S | null> {
      const mine = ++generation;
      stopStream(current);
      current = null;
      const stream = await getStream();
      if (mine !== generation) {
        stopStream(stream);
        return null;
      }
      current = stream;
      return stream;
    },
    stop() {
      generation += 1;
      stopStream(current);
      current = null;
    },
    isLive: () => current !== null,
  };
}
