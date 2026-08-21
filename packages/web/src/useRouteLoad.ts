import { useEffect } from "react";

/**
 * Fetch page data when route dependencies change.
 * Calls `reset` before `load` so stale data is not shown while fetching (Rule A).
 */
export function useRouteLoad(
  load: () => void | Promise<void>,
  deps: readonly unknown[],
  reset?: () => void,
): void {
  useEffect(() => {
    reset?.();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller owns dependency list
  }, deps);
}
