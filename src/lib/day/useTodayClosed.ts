import { useEffect, useState } from "react";

import { fetchTodayClosed } from "@/src/lib/day/queries";

// Sell uses this to stop taking sales once the owner has closed the day.
// Offline it stays false: the sale is queued and the server decides.
export function useTodayClosed(): boolean {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () =>
      fetchTodayClosed()
        .then((value) => alive && setClosed(value))
        .catch(() => {});
    void check();
    const timer = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return closed;
}
