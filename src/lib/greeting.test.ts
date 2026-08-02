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

  it("returns Good afternoon for 12pm-4pm", () => {
    expect(getTimeOfDayGreeting(atHour(12))).toBe("Good afternoon");
    expect(getTimeOfDayGreeting(atHour(16))).toBe("Good afternoon");
  });

  it("returns Good evening for 5pm-8pm", () => {
    expect(getTimeOfDayGreeting(atHour(17))).toBe("Good evening");
    expect(getTimeOfDayGreeting(atHour(20))).toBe("Good evening");
  });

  it("returns Good night for 9pm-4am", () => {
    expect(getTimeOfDayGreeting(atHour(21))).toBe("Good night");
    expect(getTimeOfDayGreeting(atHour(23))).toBe("Good night");
    expect(getTimeOfDayGreeting(atHour(0))).toBe("Good night");
    expect(getTimeOfDayGreeting(atHour(4))).toBe("Good night");
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
