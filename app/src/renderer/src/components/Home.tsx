import { useCallback, useEffect, useState } from "react";
import { useApp } from "../store";
import { buildTiles, relativeTime, SORT_LABELS, type HomeSort } from "../lib/home";
import { SettingsButton } from "./SettingsModal";
import {
  AlbumCover,
  Button,
  Field,
  Icon,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSub,
  Modal,
  NewTile,
  Tile,
} from "./ui";
import type { AlbumSummary, WorkspaceSummary } from "../../../preload";

const SORTS: HomeSort[] = ["newest", "oldest", "az", "za"];

export function Home(): JSX.Element {
  const workspaces = useApp((s) => s.workspaces);
  const setWorkspaces = useApp((s) => s.setWorkspaces);
  const openWorkspace = useApp((s) => s.openWorkspace);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "albums">("all");
  const [sort, setSort] = useState<HomeSort>("newest");
  const [query, setQuery] = useState("");
  const [openAlbumId, setOpenAlbumId] = useState<string | null>(null);
  /** Slug of the workspace awaiting a new folder name (naming dialog open). */
  const [namingFor, setNamingFor] = useState<string | null>(null);

  const refresh = useCallback(() => {
    window.api
      ?.listWorkspaces()
      .then((list) => setWorkspaces(list))
      .catch(() => setWorkspaces([]))
      .finally(() => setLoading(false));
    window.api
      ?.listAlbums()
      .then(setAlbums)
      .catch(() => {});
  }, [setWorkspaces]);

  useEffect(refresh, [refresh]);

  const openAlbum = openAlbumId ? (albums.find((a) => a.id === openAlbumId) ?? null) : null;
  const tiles = buildTiles({ workspaces, albums, tab, openAlbumId, sort, query });

  return (
    <div className="home">
      <header className="home-header">
        <div className="brand">
          <Icon name="basis-logomark" size={20} />
          <span className="home-wordmark">Basis</span>
        </div>
        <div className="home-header-actions">
          <SettingsButton />
          <Button variant="primary" size="sm" icon="plus-large" onClick={() => setCreating(true)}>
            New workspace
          </Button>
        </div>
      </header>

      <main className="home-content">
        <div className="home-hero">
          <h1>Welcome to Basis</h1>
          <p>
            Your investing copilot: watch companies' SEC filings, generate cited research briefs, x-ray your
            real exposure, and let a coach hold you to your own rules.
          </p>
        </div>

        <div className="home-toolbar">
          {openAlbum ? (
            <Button variant="secondary" size="sm" onClick={() => setOpenAlbumId(null)}>
              Back
            </Button>
          ) : (
            <div className="home-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={tab === "all"}
                className={`home-tab ${tab === "all" ? "active" : ""}`}
                onClick={() => setTab("all")}
              >
                All
              </button>
              <button
                role="tab"
                aria-selected={tab === "albums"}
                className={`home-tab ${tab === "albums" ? "active" : ""}`}
                onClick={() => setTab("albums")}
              >
                Folders
              </button>
            </div>
          )}
          <div className="home-toolbar-right">
            <SortMenu sort={sort} onChange={setSort} />
            <Input
              className="home-search"
              type="text"
              placeholder="Search..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <p className="home-loading">Loading workspaces…</p>
        ) : tiles.length === 0 && tab === "albums" && !openAlbum && query.trim() === "" ? (
          <p className="home-empty">No folders yet</p>
        ) : (
          <div className="tile-grid">
            {tiles.map((tile) =>
              tile.kind === "workspace" ? (
                <WorkspaceTile
                  key={tile.workspace.slug}
                  workspace={tile.workspace}
                  albums={albums}
                  inAlbum={Boolean(openAlbumId)}
                  onOpen={() => openWorkspace(tile.workspace.slug)}
                  onChanged={refresh}
                  onNewAlbum={() => setNamingFor(tile.workspace.slug)}
                />
              ) : (
                <AlbumTile
                  key={tile.album.id}
                  album={tile.album}
                  members={tile.members}
                  updatedAt={tile.updatedAt}
                  onOpen={() => setOpenAlbumId(tile.album.id)}
                  onChanged={refresh}
                />
              ),
            )}
            {!openAlbum && tab === "all" && (
              <NewTile icon="plus-large" onClick={() => setCreating(true)}>
                New workspace
              </NewTile>
            )}
          </div>
        )}
      </main>

      {creating && (
        <NewWorkspaceModal
          onClose={() => setCreating(false)}
          onCreated={(slug) => {
            setCreating(false);
            refresh();
            openWorkspace(slug);
          }}
        />
      )}
      {namingFor && (
        <NewAlbumDialog
          onClose={() => setNamingFor(null)}
          onCreate={async (name) => {
            const slug = namingFor;
            setNamingFor(null);
            const res = await window.api.createAlbum(name);
            if (res.ok && res.id && slug) {
              await window.api.setWorkspaceAlbum(slug, res.id);
              refresh();
            }
          }}
        />
      )}
    </div>
  );
}

/** Name-a-folder dialog — creating a folder is always an explicit, named act. */
function NewAlbumDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => void | Promise<void>;
}): JSX.Element {
  const [name, setName] = useState("");

  const create = () => {
    if (!name.trim()) return;
    void onCreate(name.trim());
  };

  return (
    <Modal
      title="New folder"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} disabled={!name.trim()}>
            Create folder
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input
          autoFocus
          value={name}
          placeholder="e.g. Retirement accounts"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
      </Field>
    </Modal>
  );
}

/** Rename dialog shared by workspaces and folders. */
function RenameDialog({
  title,
  label,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  label: string;
  initial: string;
  onClose: () => void;
  onSave: (value: string) => void | Promise<void>;
}): JSX.Element {
  const [value, setValue] = useState(initial);

  const save = () => {
    if (!value.trim()) return;
    void onSave(value.trim());
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!value.trim()}>
            Save
          </Button>
        </>
      }
    >
      <Field label={label}>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </Field>
    </Modal>
  );
}

/* ---------------- toolbar sort ---------------- */

function SortMenu({ sort, onChange }: { sort: HomeSort; onChange: (s: HomeSort) => void }): JSX.Element {
  return (
    <Menu
      className="sort-wrap"
      popClassName="sort-pop"
      trigger={(toggle) => (
        <button className="sort-btn" onClick={toggle}>
          {SORT_LABELS[sort]}
          <Icon name="chevron-top" size={16} style={{ transform: "rotate(180deg)" }} />
        </button>
      )}
    >
      {SORTS.map((s) => (
        <MenuItem key={s} onSelect={() => onChange(s)}>
          {SORT_LABELS[s]}
        </MenuItem>
      ))}
    </Menu>
  );
}

/* ---------------- tiles ---------------- */

/** Text stat block in place of a media thumbnail — workspaces have no imagery. */
function WorkspaceCover({ workspace }: { workspace: WorkspaceSummary }): JSX.Element {
  return (
    <div className="tile-thumb">
      <div className="ws-cover">
        <span className="ws-cover-stat">
          <strong>{workspace.holdings}</strong> holding{workspace.holdings === 1 ? "" : "s"}
        </span>
        <span className="ws-cover-stat">
          <strong>{workspace.watching}</strong> watching
        </span>
        {workspace.unreadAlerts > 0 && (
          <span className="ws-cover-stat alert">
            <strong>{workspace.unreadAlerts}</strong> new alert{workspace.unreadAlerts === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}

function WorkspaceTile({
  workspace,
  albums,
  inAlbum,
  onOpen,
  onChanged,
  onNewAlbum,
}: {
  workspace: WorkspaceSummary;
  albums: AlbumSummary[];
  inAlbum: boolean;
  onOpen: () => void;
  onChanged: () => void;
  onNewAlbum: () => void;
}): JSX.Element {
  const [renaming, setRenaming] = useState(false);

  const meta = [relativeTime(workspace.updatedAt)].filter(Boolean).join(" ⋅ ");

  return (
    <Tile
      media={<WorkspaceCover workspace={workspace} />}
      title={workspace.title}
      meta={meta}
      onOpen={onOpen}
      actions={
        <Menu
          className="tile-menu"
          popClassName="tile-menu-pop"
          trigger={(toggle, open) => (
            <IconButton
              icon="ellipsis"
              size={12}
              className={`tile-menu-btn ${open ? "open" : ""}`}
              label={`Options for ${workspace.title}`}
              onClick={toggle}
            />
          )}
        >
          <MenuSub icon="move-folder" label="Move to folder">
            <MenuItem icon="plus-large" onSelect={onNewAlbum}>
              New folder
            </MenuItem>
            {albums.map((a) => (
              <MenuItem
                key={a.id}
                onSelect={async () => {
                  await window.api.setWorkspaceAlbum(workspace.slug, a.id);
                  onChanged();
                }}
              >
                {a.name}
              </MenuItem>
            ))}
          </MenuSub>
          <MenuItem icon="input-form" onSelect={() => setRenaming(true)}>
            Rename workspace
          </MenuItem>
          {inAlbum && (
            <MenuItem
              icon="move-folder"
              onSelect={async () => {
                await window.api.setWorkspaceAlbum(workspace.slug, null);
                onChanged();
              }}
            >
              Remove from folder
            </MenuItem>
          )}
          <MenuItem
            icon="trash-can"
            danger
            onSelect={async () => {
              if (
                !window.confirm(`Delete "${workspace.title}"? This permanently removes the workspace folder.`)
              )
                return;
              const res = await window.api.deleteWorkspace(workspace.slug);
              if (res.ok) onChanged();
              else
                useApp
                  .getState()
                  .pushNotice("error", `Couldn't delete workspace: ${res.error ?? "unknown error"}`);
            }}
          >
            Delete workspace
          </MenuItem>
        </Menu>
      }
    >
      {renaming && (
        <RenameDialog
          title="Rename workspace"
          label="Title"
          initial={workspace.title}
          onClose={() => setRenaming(false)}
          onSave={async (title) => {
            setRenaming(false);
            if (title !== workspace.title) {
              await window.api.saveMeta(workspace.slug, { title });
              onChanged();
            }
          }}
        />
      )}
    </Tile>
  );
}

function AlbumTile({
  album,
  members,
  updatedAt,
  onOpen,
  onChanged,
}: {
  album: AlbumSummary;
  members: WorkspaceSummary[];
  updatedAt?: string;
  onOpen: () => void;
  onChanged: () => void;
}): JSX.Element {
  const [renaming, setRenaming] = useState(false);

  const meta = [`${members.length} item${members.length === 1 ? "" : "s"}`, relativeTime(updatedAt)]
    .filter(Boolean)
    .join(" ⋅ ");

  return (
    <Tile
      media={
        <AlbumCover
          cells={members.slice(0, 4).map((m) => (
            <span key={m.slug} className="album-cover-cell ws-cover-cell">
              {m.title.slice(0, 2).toUpperCase()}
            </span>
          ))}
        />
      }
      title={album.name}
      meta={meta}
      onOpen={onOpen}
      actions={
        <Menu
          className="tile-menu"
          popClassName="tile-menu-pop"
          trigger={(toggle, open) => (
            <IconButton
              icon="ellipsis"
              size={12}
              className={`tile-menu-btn ${open ? "open" : ""}`}
              label={`Options for ${album.name}`}
              onClick={toggle}
            />
          )}
        >
          <MenuItem icon="input-form" onSelect={() => setRenaming(true)}>
            Rename folder
          </MenuItem>
          <MenuItem
            icon="trash-can"
            danger
            onSelect={async () => {
              if (
                !window.confirm(`Delete the folder "${album.name}"? Its workspaces are kept and ungrouped.`)
              )
                return;
              const res = await window.api.deleteAlbum(album.id);
              if (res.ok) onChanged();
              else
                useApp
                  .getState()
                  .pushNotice("error", `Couldn't delete folder: ${res.error ?? "unknown error"}`);
            }}
          >
            Delete folder
          </MenuItem>
        </Menu>
      }
    >
      {renaming && (
        <RenameDialog
          title="Rename folder"
          label="Name"
          initial={album.name}
          onClose={() => setRenaming(false)}
          onSave={async (name) => {
            setRenaming(false);
            if (name !== album.name) {
              await window.api.renameAlbum(album.id, name);
              onChanged();
            }
          }}
        />
      )}
    </Tile>
  );
}

function NewWorkspaceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (slug: string) => void;
}): JSX.Element {
  const [title, setTitle] = useState("");
  const [tickers, setTickers] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const list = tickers
        .split(/[\s,]+/)
        .map((t) => t.toUpperCase().trim())
        .filter(Boolean);
      const res = await window.api.createWorkspace({ title, tickers: list });
      if (!res.ok || !res.slug) {
        setError(res.error ?? "Could not create workspace");
        return;
      }
      onCreated(res.slug);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New workspace"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void create()} disabled={busy || !title.trim()}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </>
      }
    >
      <Field label="Title">
        <Input
          autoFocus
          value={title}
          placeholder="e.g. My long-term portfolio"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
        />
      </Field>
      <Field label="Watchlist tickers (optional)">
        <Input
          value={tickers}
          placeholder="AAPL, MSFT, BFLY"
          onChange={(e) => setTickers(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && void create()}
        />
      </Field>
      {error && <p className="ui-form-error">{error}</p>}
    </Modal>
  );
}
