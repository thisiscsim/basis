import type { AlbumSummary, WorkspaceSummary } from "../../../preload";

export type HomeSort = "newest" | "oldest" | "az" | "za";

export const SORT_LABELS: Record<HomeSort, string> = {
  newest: "By newest",
  oldest: "By oldest",
  az: "Name A–Z",
  za: "Name Z–A",
};

/** A grid tile: either a single workspace or a folder (album) of workspaces. */
export type HomeTile =
  | { kind: "workspace"; workspace: WorkspaceSummary }
  | { kind: "album"; album: AlbumSummary; members: WorkspaceSummary[]; updatedAt?: string };

const time = (iso?: string) => (iso ? new Date(iso).getTime() : 0);

export function matchesQuery(title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || title.toLowerCase().includes(q);
}

function tileName(tile: HomeTile): string {
  return tile.kind === "workspace" ? tile.workspace.title : tile.album.name;
}

function tileTime(tile: HomeTile): number {
  return tile.kind === "workspace" ? time(tile.workspace.updatedAt) : time(tile.updatedAt);
}

export function sortTiles(tiles: HomeTile[], sort: HomeSort): HomeTile[] {
  const sorted = [...tiles];
  switch (sort) {
    case "newest":
      return sorted.sort((a, b) => tileTime(b) - tileTime(a));
    case "oldest":
      return sorted.sort((a, b) => tileTime(a) - tileTime(b));
    case "az":
      return sorted.sort((a, b) => tileName(a).localeCompare(tileName(b)));
    case "za":
      return sorted.sort((a, b) => tileName(b).localeCompare(tileName(a)));
    default: {
      const exhaustive: never = sort;
      return exhaustive;
    }
  }
}

/**
 * Compose the grid for the current view.
 * - All tab: ungrouped workspaces + one tile per folder (workspaces inside a
 *   folder are represented by their folder tile).
 * - Folders tab: folder tiles only.
 * - Folder drill-in: the folder's member workspaces.
 * Search matches workspace titles / folder names; sort applies to the result.
 * A folder's timestamp is its latest member activity (or its creation time).
 */
export function buildTiles(input: {
  workspaces: WorkspaceSummary[];
  albums: AlbumSummary[];
  tab: "all" | "albums";
  openAlbumId: string | null;
  sort: HomeSort;
  query: string;
}): HomeTile[] {
  const { workspaces, albums, tab, openAlbumId, sort, query } = input;

  if (openAlbumId) {
    const members = workspaces.filter((w) => w.albumId === openAlbumId && matchesQuery(w.title, query));
    return sortTiles(
      members.map((workspace) => ({ kind: "workspace", workspace })),
      sort,
    );
  }

  const albumIds = new Set(albums.map((a) => a.id));
  const albumTiles: HomeTile[] = albums.map((album) => {
    const members = sortTiles(
      workspaces
        .filter((w) => w.albumId === album.id)
        .map((workspace) => ({ kind: "workspace" as const, workspace })),
      "newest",
    ).map((t) => (t as Extract<HomeTile, { kind: "workspace" }>).workspace);
    const updatedAt =
      members
        .map((m) => m.updatedAt)
        .filter(Boolean)
        .sort()
        .pop() ?? album.createdAt;
    return { kind: "album", album, members, updatedAt };
  });

  const tiles: HomeTile[] =
    tab === "albums"
      ? albumTiles
      : [
          ...workspaces
            // Workspaces pointing at a deleted/unknown folder are treated as ungrouped.
            .filter((w) => !w.albumId || !albumIds.has(w.albumId))
            .map((workspace) => ({ kind: "workspace" as const, workspace })),
          ...albumTiles,
        ];

  return sortTiles(
    tiles.filter((t) => matchesQuery(tileName(t), query)),
    sort,
  );
}

export function relativeTime(iso?: string): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}
