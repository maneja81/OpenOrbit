import { useState } from "react";
import WidgetCard from "@/components/atoms/WidgetCard";
import Combobox from "@/components/atoms/Combobox";
import StepFeed from "@/components/molecules/StepFeed";
import { useTokenUsage, TokenUsageRange } from "@/hooks/useTokenUsage";
import { StepEvent } from "@/lib/agents";
import { formatTokens, formatCost } from "@/lib/tokenFormat";

const RANGES: { key: TokenUsageRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "all", label: "All" },
];

const RANGE_LABELS: Record<TokenUsageRange, string> = {
  today: "Today",
  week: "This Week",
  all: "All Time",
};

interface TokenUsageWidgetProps {
  steps: StepEvent[];
}

export default function TokenUsageWidget({ steps }: TokenUsageWidgetProps) {
  const [range, setRange] = useState<TokenUsageRange>("today");
  const [model, setModel] = useState<string | null>(null);
  const data = useTokenUsage(range, model);
  const inputPct = data.totalTokens > 0 ? Math.round((data.inputTokens / data.totalTokens) * 100) : 0;

  return (
    <WidgetCard id="widget-token-usage" title="Agent Activity & Usage">
      <div className="tu-filter">
        {RANGES.map((r) => (
          <button
            key={r.key}
            className={`tu-filter-btn${range === r.key ? " active" : ""}`}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {data.models.length > 0 && (
        <div className="tu-model-select">
          <Combobox
            value={model ?? ""}
            options={[{ value: "", label: "All Models" }, ...data.models.map((m) => ({ value: m, label: m }))]}
            onChange={(v) => setModel(v || null)}
            ariaLabel="Filter by model"
            size="sm"
          />
        </div>
      )}

      <div className="tu-total">
        <span className="tu-total-value">{formatTokens(data.totalTokens)}</span>
        <span className="tu-total-label">tokens · {RANGE_LABELS[range]}</span>
      </div>

      <div className="tu-bar">
        <div className="tu-bar-input" style={{ width: `${inputPct}%` }} />
        <div className="tu-bar-output" style={{ width: `${100 - inputPct}%` }} />
      </div>

      <div className="tu-legend">
        <div className="tu-legend-item">
          <span className="tu-dot input" />
          <span>Input</span>
          <span className="tu-legend-value">{formatTokens(data.inputTokens)}</span>
        </div>
        <div className="tu-legend-item">
          <span className="tu-dot output" />
          <span>Output</span>
          <span className="tu-legend-value">{formatTokens(data.outputTokens)}</span>
        </div>
        <div className="tu-legend-item">
          <span className="tu-dot cost" />
          <span>Cost</span>
          <span className="tu-legend-value">{formatCost(data.costUsd)}</span>
        </div>
      </div>

      <div className="tu-activity-section">
        <StepFeed steps={steps} />
      </div>
    </WidgetCard>
  );
}
