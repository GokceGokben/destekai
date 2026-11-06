"""Per-sender limits on chat messages, so one signed-in account cannot burn the model quota.

Sliding windows in process memory, like the order API's login limit: right for a single
instance, a shared store (Redis) for several.
"""

import time
from collections import deque
from collections.abc import Callable


class ChatLimiter:
    def __init__(
        self,
        per_minute: int,
        per_day: int,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._windows = ((60.0, per_minute), (86_400.0, per_day))
        self._now = now
        self._sent: dict[str, deque[float]] = {}

    def allow(self, sender: str) -> bool:
        """Records the message and returns True, or returns False without recording it."""
        now = self._now()
        sent = self._sent.setdefault(sender, deque())
        # Only the longest window's history is needed; older entries can go.
        while sent and sent[0] <= now - self._windows[-1][0]:
            sent.popleft()
        for length, limit in self._windows:
            if sum(1 for at in sent if at > now - length) >= limit:
                return False
        sent.append(now)
        return True
