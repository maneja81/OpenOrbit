/** Time-of-day greeting bands, using the machine's own local time (same convention as
 * agents.ts's getCurrentDateTime on the main-process side) — 5–11 morning, 12–17
 * afternoon, 18–20 evening, everything else (21–4) late.
 *
 * The late band deliberately does not say "Good night". This line only renders while
 * someone is actively using the app, so a send-off is precisely the wrong thing to say at
 * the moment they sat down — "Good night, Mohit!" greeted an 11pm working session.
 * "Still at it" acknowledges the hour without assuming they're on their way to bed, and
 * stays true across the whole 9pm–5am stretch, so the small hours need no band of their
 * own. Afternoon runs to 18:00 because 5pm reads as afternoon on a working day. */
export function getTimeOfDayGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 21) return "Good evening";
  return "Still at it";
}

/** The status-bar line. Falls back to "there" because userName defaults to "" and is only
 * filled in by onboarding. */
export function buildGreeting(userName: string, date?: Date): string {
  return `${getTimeOfDayGreeting(date)}, ${userName || "there"}!`;
}
