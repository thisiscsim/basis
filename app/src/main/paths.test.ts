import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { assertSlug, isSafeExternalUrl, safePath, slugify } from "./paths";

// safePath is the core containment control for renderer-supplied slugs/ids;
// these lock in the traversal + sibling-prefix guarantees.
describe("safePath", () => {
  const root = "/home/user/Basis/workspaces";

  it("allows the root itself and legit children", () => {
    expect(safePath(root, [])).toBe(root);
    expect(safePath(root, ["demo", "portfolio.json"])).toBe(join(root, "demo/portfolio.json"));
  });

  it("rejects .. traversal out of the root", () => {
    expect(() => safePath(root, ["../secrets"])).toThrow();
    expect(() => safePath(root, ["demo", "..", "..", "etc"])).toThrow();
  });

  it("rejects a sibling directory that merely shares the root prefix", () => {
    // "<root>-evil" starts with the root string but is not inside it.
    expect(() => safePath(root, ["../workspaces-evil"])).toThrow();
  });

  it("contains an absolute-looking segment under the root (join treats it as relative)", () => {
    // path.join folds a leading slash into a normal segment, so this stays
    // inside root rather than escaping to /etc.
    expect(safePath(root, ["/etc/passwd"])).toBe(join(root, "etc/passwd"));
  });
});

describe("assertSlug", () => {
  it("accepts sane slugs", () => {
    expect(() => assertSlug("my-workspace")).not.toThrow();
    expect(() => assertSlug("Fund_01")).not.toThrow();
  });

  it("rejects traversal, separators, empties, and overlong ids", () => {
    for (const bad of ["../etc", "a/b", "a\\b", "", "-leading", "x".repeat(65)]) {
      expect(() => assertSlug(bad)).toThrow();
    }
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

describe("slugify", () => {
  it("slugifies titles and falls back to 'workspace'", () => {
    expect(slugify("My Retirement Fund!")).toBe("my-retirement-fund");
    expect(slugify("   ")).toBe("workspace");
    expect(slugify("!!!")).toBe("workspace");
  });
});
