import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { RateLimitedError, streamChat, UnauthorizedError } from "./api";
import { chatReducer, initialChatState } from "./chatReducer";
import { formatTime } from "./format";

const CONNECTION_ERROR = "Bağlantı kesildi. Lütfen tekrar deneyin.";
const RATE_LIMITED = "Çok kısa sürede çok fazla mesaj gönderdiniz. Lütfen bir dakika sonra tekrar deneyin.";

export function useChat(token: string, onUnauthorized: () => void) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const conversationId = useRef(crypto.randomUUID());
  const abort = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      // The agent does not serialize messages of one conversation (decision 013).
      if (abort.current) return;
      const controller = new AbortController();
      abort.current = controller;
      const startedAt = performance.now();
      dispatch({ type: "send", text, time: formatTime(new Date()) });

      let finished = false;
      try {
        for await (const event of streamChat(
          token,
          conversationId.current,
          text,
          controller.signal,
        )) {
          dispatch({ type: "event", event, at: performance.now() });
          finished = event.event === "done" || event.event === "error";
          if (event.event === "done") setLatencyMs(performance.now() - startedAt);
        }
        if (!finished) dispatch({ type: "failed", message: CONNECTION_ERROR });
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          onUnauthorized();
        } else if (error instanceof RateLimitedError) {
          dispatch({ type: "failed", message: RATE_LIMITED });
        } else if (!controller.signal.aborted) {
          dispatch({ type: "failed", message: CONNECTION_ERROR });
        }
      } finally {
        if (abort.current === controller) abort.current = null;
      }
    },
    [token, onUnauthorized],
  );

  const reset = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    conversationId.current = crypto.randomUUID();
    dispatch({ type: "reset" });
  }, []);

  useEffect(() => () => abort.current?.abort(), []);

  return { state, latencyMs, send, reset };
}
