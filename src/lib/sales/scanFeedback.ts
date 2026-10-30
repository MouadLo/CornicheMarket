import { Audio } from "expo-av";
import { useCallback, useEffect, useRef } from "react";
import { Vibration } from "react-native";

import type { ScanStatus } from "@/src/lib/sales/scanRules";

/* eslint-disable @typescript-eslint/no-require-imports */
const OK_SOUND = require("@/assets/sounds/scan-ok.wav");
const BAD_SOUND = require("@/assets/sounds/scan-bad.wav");

// A short tick for a product that was added; a longer, doubled pattern with a
// lower sound for a code that wasn't recognised or a failed lookup.
export const ACCEPT_VIBRATION_MS = 40;
export const REJECT_VIBRATION_PATTERN = [0, 150, 100, 150];

type Sounds = { ok: Audio.Sound | null; bad: Audio.Sound | null };

// Loads the two sounds while the scanner is open and returns the function that
// plays feedback for one accepted scan. Feedback must never get in the way of
// scanning: a sound that can't load or play is simply skipped.
export function useScanFeedback(enabled: boolean): (status: ScanStatus) => void {
  const sounds = useRef<Sounds>({ ok: null, bad: null });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async (asset: unknown): Promise<Audio.Sound | null> => {
      try {
        const { sound } = await Audio.Sound.createAsync(asset as number);
        if (cancelled) {
          await sound.unloadAsync();
          return null;
        }
        return sound;
      } catch {
        return null;
      }
    };

    (async () => {
      // iOS mutes sounds with the silent switch on unless told otherwise.
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
      const [ok, bad] = await Promise.all([load(OK_SOUND), load(BAD_SOUND)]);
      if (!cancelled) sounds.current = { ok, bad };
    })();

    return () => {
      cancelled = true;
      const { ok, bad } = sounds.current;
      sounds.current = { ok: null, bad: null };
      ok?.unloadAsync().catch(() => {});
      bad?.unloadAsync().catch(() => {});
    };
  }, [enabled]);

  return useCallback((status: ScanStatus) => {
    const accepted = status === "added";
    Vibration.vibrate(accepted ? ACCEPT_VIBRATION_MS : REJECT_VIBRATION_PATTERN);
    const sound = accepted ? sounds.current.ok : sounds.current.bad;
    sound?.replayAsync().catch(() => {});
  }, []);
}
