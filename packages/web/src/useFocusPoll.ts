import { useEffect, useRef } from "react";

/** Poll `callback` while the document is focused. */
export function useFocusPoll(callback: () => void, intervalMs: number): void {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      saved.current();
    };
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
}
