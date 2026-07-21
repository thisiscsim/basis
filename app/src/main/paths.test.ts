import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { isSafeExternalUrl, safePath } from "./paths";

// safePath is the core containment control for renderer-supplied filenames;
// these lock in the traversal + sibling-prefix guarantees.
describe("safePath", () => {
  const root = "/home/user/Basis";

  it("allows the root itself and legit children", () => {
    expect(safePath(root, [])).toBe(root);
    expect(safePath(root, ["briefs", "AAPL-2026-07-21.json"])).toBe(
      join(root, "briefs/AAPL-2026-07-21.json"),
    );
  });

  it("rejects .. traversal out of the root", () => {
    expect(() => safePath(root, ["../secrets"])).toThrow();
    expect(() => safePath(root, ["briefs", "..", "..", "etc"])).toThrow();
  });

  it("rejects a sibling directory that merely shares the root prefix", () => {
    // "<root>-evil" starts with the root string but is not inside it.
    expect(() => safePath(root, ["../Basis-evil"])).toThrow();
  });

  it("contains an absolute-looking segment under the root (join treats it as relative)", () => {
    // path.join folds a leading slash into a normal segment, so this stays
    // inside root rather than escaping to /etc.
    expect(safePath(root, ["/etc/passwd"])).toBe(join(root, "etc/passwd"));
  });
});

describe("isSafeExternalUrl", () => {
  it("allows only https", () => {
    expect(isSafeExternalUrl("https://example.com")).toBe(true);
    expect(isSafeExternalUrl("http://example.com")).toBe(false);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeExternalUrl("smb://host/share")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
  });
});
