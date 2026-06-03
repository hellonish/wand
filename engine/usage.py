"""Token usage tracking for all LLM providers.

Each client in engine/providers.py attaches to a UsageCollector (if one is supplied).
Every complete() call records a Usage item. The gateway reads .cost_usd() to write
UsageEvent rows. Callers that do not supply a collector get normal behaviour unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# ── Provider pricing, USD per token ──────────────────────────────────────────
# UPDATE this dict whenever xAI changes published pricing.
# Current figures: Grok-3  input $3.00/1M  output $15.00/1M
RATES: dict[str, dict[str, float]] = {
    "grok-3": {"in": 3.00 / 1_000_000, "out": 15.00 / 1_000_000},
    # DeepSeek kept here for completeness even though we route Grok-only.
    "deepseek-chat": {"in": 0.27 / 1_000_000, "out": 1.10 / 1_000_000},
}

_FALLBACK_RATE = {"in": 3.00 / 1_000_000, "out": 15.00 / 1_000_000}


@dataclass
class Usage:
    """Token counts for a single complete() call."""

    input_tokens: int
    output_tokens: int
    provider: str   # "grok" | "deepseek"
    model: str      # "grok-3" | "deepseek-chat"


@dataclass
class StepTrace:
    """Wall-clock latency and token counts for a single named pipeline step."""

    step: str
    duration_ms: float
    input_tokens: int
    output_tokens: int


@dataclass
class UsageCollector:
    """Accumulates Usage items across all complete() calls within one task."""

    items: list[Usage] = field(default_factory=list)
    traces: list[StepTrace] = field(default_factory=list)

    def add(self, u: Usage) -> None:
        self.items.append(u)

    def record_step(self, step: str, duration_ms: float, usage: Usage) -> None:
        self.traces.append(
            StepTrace(
                step=step,
                duration_ms=duration_ms,
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
            )
        )

    @property
    def input_tokens(self) -> int:
        return sum(i.input_tokens for i in self.items)

    @property
    def output_tokens(self) -> int:
        return sum(i.output_tokens for i in self.items)

    def cost_usd(self) -> float:
        """Sum of (input * in_rate + output * out_rate) across all calls."""
        total = 0.0
        for item in self.items:
            rate = RATES.get(item.model, _FALLBACK_RATE)
            total += item.input_tokens * rate["in"] + item.output_tokens * rate["out"]
        return round(total, 8)

    @property
    def provider(self) -> str:
        return self.items[0].provider if self.items else "grok"

    @property
    def model(self) -> str:
        return self.items[0].model if self.items else "grok-3"

    def is_empty(self) -> bool:
        return len(self.items) == 0
