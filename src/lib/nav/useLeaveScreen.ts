import { router, useNavigation, usePathname } from "expo-router";
import { useCallback } from "react";

import { backTarget, getOrigin } from "./origin";

// "Done here, go back to where I was" for a form screen (after Save). With an
// earlier screen in its own stack: the usual back. Alone in its stack (opened
// from another section): the exact place it was opened from. `to` forces the
// destination (e.g. a given Concurrents tab) after leaving the stack.
export function useLeaveScreen(): (to?: { pathname: string; params?: object }) => void {
  const navigation = useNavigation();
  const pathname = usePathname();
  return useCallback(
    (to) => {
      const inStack = navigation.getState().index > 0;
      if (to) {
        if (inStack) router.back();
        router.navigate(to as never);
        return;
      }
      const target = backTarget({ inStack, isRoot: false, pathname, origin: getOrigin() });
      if (target.kind === "href") router.navigate(target.href as never);
      else router.back();
    },
    [navigation, pathname]
  );
}
