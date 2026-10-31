import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";

// Keeps the screen on while this part of the app is the one being used, and
// releases it the moment the cashier leaves for another section, so the
// tablet still sleeps normally while someone is in Reports or Settings.
// Failure to get a wake lock (a browser refusing, no permission) must never
// affect selling, so it is swallowed.
export function useKeepAwakeWhileFocused(tag: string): void {
  useFocusEffect(
    useCallback(() => {
      activateKeepAwakeAsync(tag).catch(() => {});
      return () => {
        deactivateKeepAwake(tag).catch(() => {});
      };
    }, [tag])
  );
}
