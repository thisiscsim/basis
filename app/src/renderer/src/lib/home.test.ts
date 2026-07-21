import { describe, expect, it } from "vitest";
import type { AlbumSummary, WorkspaceSummary } from "../../../preload";
import { buildTiles, matchesQuery, relativeTime, sortTiles, type HomeTile } from "./home";

const ws = (slug: string, title: string, updatedAt?: string, albumId?: string): WorkspaceSummary => ({
  slug,
  title,
  status: "active",
  holdings: 0,
  watching: 0,
  unreadAlerts: 0,
  updatedAt,
  albumId,
});

const album = (id: string, name: string, createdAt: string): AlbumSummary => ({ id, name, createdAt });

describe("matchesQuery", () => {
  it("is case-insensitive and matches everything on empty query", () => {
    expect(matchesQuery("Retirement Fund", "retire")).toBe(true);
    expect(matchesQuery("Retirement Fund", "")).toBe(true);
    expect(matchesQuery("Retirement Fund", "crypto")).toBe(false);
  });
});

describe("sortTiles", () => {
  const tiles: HomeTile[] = [
    { kind: "workspace", workspace: ws("a", "Alpha", "2026-01-01T00:00:00Z") },
    { kind: "workspace", workspace: ws("z", "Zulu", "2026-06-01T00:00:00Z") },
  ];

  it("sorts by recency and by name", () => {
    expect(sortTiles(tiles, "newest")[0].kind === "workspace" && "Zulu").toBe("Zulu");
    const az = sortTiles(tiles, "az");
    expect((az[0] as Extract<HomeTile, { kind: "workspace" }>).workspace.title).toBe("Alpha");
    const za = sortTiles(tiles, "za");
    expect((za[0] as Extract<HomeTile, { kind: "workspace" }>).workspace.title).toBe("Zulu");
  });
});

describe("buildTiles", () => {
  const workspaces = [
    ws("solo", "Solo fund", "2026-07-01T00:00:00Z"),
    ws("ira", "IRA", "2026-07-02T00:00:00Z", "family"),
    ws("529", "College 529", "2026-07-03T00:00:00Z", "family"),
    ws("ghost", "Orphan", "2026-07-04T00:00:00Z", "deleted-folder"),
  ];
  const albums = [album("family", "Family", "2026-06-01T00:00:00Z")];

  it("All tab: ungrouped workspaces + one tile per folder; orphans are ungrouped", () => {
    const tiles = buildTiles({ workspaces, albums, tab: "all", openAlbumId: null, sort: "az", query: "" });
    const names = tiles.map((t) => (t.kind === "workspace" ? t.workspace.title : t.album.name));
    expect(names).toContain("Solo fund");
    expect(names).toContain("Family");
    expect(names).toContain("Orphan");
    expect(names).not.toContain("IRA"); // represented by its folder tile
  });

  it("folder drill-in lists only members and honors search", () => {
    const tiles = buildTiles({
      workspaces,
      albums,
      tab: "all",
      openAlbumId: "family",
      sort: "az",
      query: "ira",
    });
    expect(tiles).toHaveLength(1);
    expect((tiles[0] as Extract<HomeTile, { kind: "workspace" }>).workspace.slug).toBe("ira");
  });

  it("a folder's timestamp is its newest member activity", () => {
    const tiles = buildTiles({
      workspaces,
      albums,
      tab: "albums",
      openAlbumId: null,
      sort: "newest",
      query: "",
    });
    const folder = tiles[0] as Extract<HomeTile, { kind: "album" }>;
    expect(folder.updatedAt).toBe("2026-07-03T00:00:00Z");
  });
});

describe("relativeTime", () => {
  it("formats recent and old timestamps, null for garbage", () => {
    expect(relativeTime(new Date(Date.now() - 30_000).toISOString())).toBe("just now");
    expect(relativeTime(new Date(Date.now() - 2 * 3600_000).toISOString())).toBe("2 hours ago");
    expect(relativeTime(undefined)).toBeNull();
    expect(relativeTime("not a date")).toBeNull();
  });
});
