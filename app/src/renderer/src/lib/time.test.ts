import { describe, expect, it } from "vitest";
import { relativeTime } from "./time";

describe("relativeTime", () => {
  it("formats recent and old timestamps, null for garbage", () => {
    expect(relativeTime(new Date(Date.now() - 30_000).toISOString())).toBe("just now");
    expect(relativeTime(new Date(Date.now() - 2 * 3600_000).toISOString())).toBe("2 hours ago");
    expect(relativeTime(new Date(Date.now() - 3 * 24 * 3600_000).toISOString())).toBe("3 days ago");
    expect(relativeTime(undefined)).toBeNull();
    expect(relativeTime("not a date")).toBeNull();
  });
});
