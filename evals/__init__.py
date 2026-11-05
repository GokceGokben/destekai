"""The evaluation suite: a simulated customer talks to the running agent, then deterministic
checks and an LLM judge score the conversation.

It runs in the agent service's environment and reuses its LLM client, so there is one
provider interface and one set of pinned dependencies. Usage, from the repository root:

    uv run --project agent-service python -m evals.run --subset 5
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "agent-service"))
