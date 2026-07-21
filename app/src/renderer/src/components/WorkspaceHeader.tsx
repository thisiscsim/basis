import { useApp, type WorkspaceTab } from "../store";
import { SettingsButton } from "./SettingsModal";
import { Icon } from "./ui";

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "digest", label: "Digest" },
  { id: "research", label: "Research" },
  { id: "coach", label: "Coach" },
];

export function WorkspaceHeader(): JSX.Element {
  const meta = useApp((s) => s.ws?.meta ?? null);
  const slug = useApp((s) => s.slug);
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const goHome = useApp((s) => s.goHome);

  const title = meta?.title || slug || "Untitled";

  return (
    <header className="ws-header">
      <div className="ws-header-left">
        <button className="brand" onClick={goHome} title="Back to workspaces">
          <Icon name="basis-logomark" size={20} />
          <span className="home-wordmark">Basis</span>
        </button>
        <span className="ws-header-title" title={title}>
          {title}
        </span>
      </div>

      <nav className="ws-tabs" role="tablist" aria-label="Workspace views">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`ws-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="ws-header-actions">
        <SettingsButton />
      </div>
    </header>
  );
}
