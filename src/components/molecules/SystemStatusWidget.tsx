import WidgetCard from "@/components/atoms/WidgetCard";
import { useSystemStats } from "@/hooks/useSystemStats";
import { useLocationInfo } from "@/hooks/useLocationInfo";

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function gaugeLabel(ramPct: number): string {
  if (ramPct < 60) return "Optimal";
  if (ramPct < 85) return "Moderate";
  return "High Load";
}

interface SystemStatusWidgetProps {
  locationEnabled: boolean;
}

export default function SystemStatusWidget({ locationEnabled }: SystemStatusWidgetProps) {
  const stats = useSystemStats();
  const locationInfo = useLocationInfo(locationEnabled);
  const locationLabel = [locationInfo?.city, locationInfo?.country].filter(Boolean).join(", ");
  const ramPct = stats?.ramPct ?? 0;
  const dashOffset = CIRCUMFERENCE * (1 - ramPct / 100);

  const metrics = stats
    ? [
        { label: "CPU", pct: stats.cpuPct, detail: `${stats.cpuPct}%` },
        { label: "RAM", pct: stats.ramPct, detail: `${stats.ramUsedGB}/${stats.ramTotalGB} GB` },
        { label: "Disk", pct: stats.diskPct, detail: `${stats.diskUsedGB}/${stats.diskTotalGB} GB` },
      ]
    : [];

  return (
    <WidgetCard id="widget-system-status" title="System Status">
      <div className="ss-gauge-wrap">
        <svg className="ss-gauge" viewBox="0 0 110 110">
          <circle className="ss-gauge-track" cx="55" cy="55" r={RADIUS} />
          <circle
            className="ss-gauge-fill"
            cx="55"
            cy="55"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <div className="ss-gauge-center">
          <span className="ss-gauge-pct">{stats ? `${ramPct}%` : "—"}</span>
          <span className="ss-gauge-label">{stats ? gaugeLabel(ramPct) : "Loading…"}</span>
        </div>
      </div>
      <div className="ss-metrics">
        {metrics.map((m) => (
          <div className="ss-metric-row" key={m.label}>
            <span className="ss-metric-label">{m.label}</span>
            <div className="ss-metric-track">
              <div className="ss-metric-fill" style={{ width: `${m.pct}%` }} />
            </div>
            <span className="ss-metric-pct">{m.detail}</span>
          </div>
        ))}
        {locationEnabled && locationLabel && (
          <div className="ss-metric-row ss-metric-row-location">
            <span className="ss-metric-label">Location</span>
            <span className="ss-metric-pct">{locationLabel}</span>
          </div>
        )}
      </div>
    </WidgetCard>
  );
}
