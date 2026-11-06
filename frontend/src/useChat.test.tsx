import { act, renderHook } from "@testing-library/react";

import { useChat } from "./useChat";

afterEach(() => vi.unstubAllGlobals());

test("a rate-limited message explains the wait instead of a broken connection", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ detail: "rate_limited" }), { status: 429 })),
  );
  const { result } = renderHook(() => useChat("token", vi.fn()));

  await act(() => result.current.send("Merhaba"));

  const last = result.current.state.messages.at(-1)!;
  expect(last.error).toBe(true);
  expect(last.text).toContain("bir dakika sonra");
});
