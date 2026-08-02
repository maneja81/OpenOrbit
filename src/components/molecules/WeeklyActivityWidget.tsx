import WidgetCard from "@/components/atoms/WidgetCard";
import { useWeeklyActivity } from "@/hooks/useWeeklyActivity";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function WeeklyActivityWidget() {
  const days = useWeeklyActivity();
  const maxTokens = Math.max(1, ...days.map((d) => d.totalTokens));
  const peakDate = days.reduce(
    (a, b) => (b.totalTokens > a.totalTokens ? b : a),
    days[0] ?? { date: "", totalTokens: 0 }
  ).date;

  return (
    <WidgetCard title="Weekly Activity" headerRight={<span className="widget-card-subtext">This Week</span>}>
      <div className="wa-chart">
        {days.map((day) => {
          const isPeak = day.date === peakDate && day.totalTokens > 0;
          const pct = (day.totalTokens / maxTokens) * 100;
          const label = WEEKDAY_LABELS[new Date(`${day.date}T00:00:00`).getDay()];
          return (
            <div className="wa-col" key={day.date}>
              {isPeak && <span className="wa-tooltip">{day.totalTokens.toLocaleString()} tok</span>}
              <div className="wa-bar-track">
                <div className={`wa-bar${isPeak ? " peak" : ""}`} style={{ height: `${pct}%` }} />
              </div>
              <span className={`wa-label${isPeak ? " peak" : ""}`}>{label}</span>
            </div>
          );
        })}
      </div>
    </WidgetCard>
  );
}
