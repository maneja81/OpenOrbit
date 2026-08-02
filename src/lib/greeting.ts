/** Time-of-day greeting bands, using the machine's own local time (same convention as
 * agents.ts's getCurrentDateTime on the main-process side) — 5–11 morning, 12–16
 * afternoon, 17–20 evening, everything else (21–4) night. */
export function getTimeOfDayGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 21) return "Good evening";
  return "Good night";
}

/** The status-bar line. Falls back to "there" because userName defaults to "" and is only
 * filled in by onboarding. */
export function buildGreeting(userName: string, date?: Date): string {
  return `${getTimeOfDayGreeting(date)}, ${userName || "there"}!`;
}
