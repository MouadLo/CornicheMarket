import { useNavigation } from "expo-router";
import { useEffect, useRef } from "react";

import { confirm } from "@/src/lib/dialog/store";

type Texts = { title: string; message: string; leave: string; stay: string };

// Asks before leaving a screen with unsaved changes (back button, swipe,
// browser back). The returned setDirty writes straight to a ref, so calling
// setDirty(false) right before navigating away on purpose (after a successful
// save) takes effect at once, without waiting for a render.
export function useUnsavedGuard(texts: Texts) {
  const navigation = useNavigation();
  const dirtyRef = useRef(false);
  const textsRef = useRef(texts);
  textsRef.current = texts;

  useEffect(() => {
    return navigation.addListener("beforeRemove", (event) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      const { title, message, leave, stay } = textsRef.current;
      confirm({ tone: "danger", title, message, confirmLabel: leave, cancelLabel: stay }).then(
        (ok) => {
          if (ok) {
            dirtyRef.current = false;
            navigation.dispatch(event.data.action);
          }
        }
      );
    });
  }, [navigation]);

  return (dirty: boolean) => {
    dirtyRef.current = dirty;
  };
}
