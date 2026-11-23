import { useGlobalSearchParams, usePathname } from "expo-router";
import { useEffect } from "react";

import { buildHref, trackLocation } from "./origin";

// Mount once inside the signed-in layout: records every location so the
// section back arrow knows where the owner came from (see origin.ts).
export function useNavOrigin(): void {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const href = buildHref(pathname, params as Record<string, string | string[] | undefined>);
  useEffect(() => {
    trackLocation(href);
  }, [href]);
}
