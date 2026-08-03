import { describe, expect, it } from "vitest";
import { buildGreeting, getTimeOfDayGreeting } from "./greeting";

function atHour(hour: number): Date {
  const d = new Date(2026, 0, 1, hour, 0, 0);
  return d;
}

describe("getTimeOfDayGreeting", () => {
  it("returns Good morning for 5am-11am", () => {
    expect(getTimeOfDayGreeting(atHour(5))).toBe("Good morning");
    expect(getTimeOfDayGreeting(atHour(11))).toBe("Good morning");
  });

  it("returns Good afternoon for 12pm-5pm", () => {
    expect(getTimeOfDayGreeting(atHour(12))).toBe("Good afternoon");
    expect(getTimeOfDayGreeting(atHour(17))).toBe("Good afternoon");
  });

  it("returns Good evening for 6pm-8pm", () => {
    expect(getTimeOfDayGreeting(atHour(18))).toBe("Good evening");
    expect(getTimeOfDayGreeting(atHour(20))).toBe("Good evening");
  });

  // Never "Good night" — the line only renders while the app is in use, so a send-off is
  // wrong at exactly the moment the user sat down.
  it("returns Still at it for 9pm-4am", () => {
    expect(getTimeOfDayGreeting(atHour(21))).toBe("Still at it");
    expect(getTimeOfDayGreeting(atHour(23))).toBe("Still at it");
    expect(getTimeOfDayGreeting(atHour(0))).toBe("Still at it");
    expect(getTimeOfDayGreeting(atHour(4))).toBe("Still at it");
  });

  // Moving a boundary is the one edit that can silently leave an hour in the wrong band,
  // and the bands are ordered ifs rather than an exhaustive map, so pin all 24.
  it("assigns every hour of the day to the expected band", () => {
    const expected = [
      ...Array<string>(5).fill("Still at it"), // 0-4
      ...Array<string>(7).fill("Good morning"), // 5-11
      ...Array<string>(6).fill("Good afternoon"), // 12-17
      ...Array<string>(3).fill("Good evening"), // 18-20
      ...Array<string>(3).fill("Still at it"), // 21-23
    ];
    expect(expected).toHaveLength(24);
    for (let hour = 0; hour < 24; hour++) {
      expect(getTimeOfDayGreeting(atHour(hour))).toBe(expected[hour]);
    }
  });
});

describe("buildGreeting", () => {
  it("greets the user by name", () => {
    expect(buildGreeting("Mohit", atHour(14))).toBe("Good afternoon, Mohit!");
  });

  it("falls back to 'there' when no name is set", () => {
    expect(buildGreeting("", atHour(14))).toBe("Good afternoon, there!");
  });
});
