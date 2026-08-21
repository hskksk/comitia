import { cleanup, render, screen } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRouteLoad } from "./useRouteLoad.js";

function Probe({
  id,
  load,
}: {
  id: string;
  load: () => void | Promise<void>;
}) {
  const [label, setLabel] = useState<string | null>(null);

  const reset = useCallback(() => {
    setLabel(null);
  }, []);

  const runLoad = useCallback(() => {
    void Promise.resolve(load()).then(() => setLabel(`loaded:${id}`));
  }, [id, load]);

  useRouteLoad(runLoad, [id], reset);

  return <p>{label === null ? "loading" : label}</p>;
}

describe("useRouteLoad", () => {
  afterEach(cleanup);

  it("resets before loading when dependencies change", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<Probe id="a" load={load} />);

    expect(await screen.findByText("loaded:a")).toBeInTheDocument();

    rerender(<Probe id="b" load={load} />);
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findByText("loaded:b")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
