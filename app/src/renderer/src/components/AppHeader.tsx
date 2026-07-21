import { useApp, type AppTab } from "../store";
import { SettingsButton } from "./SettingsModal";
import { Icon } from "./ui";

const TABS: { id: AppTab; label: string }[] = [
  { id: "digest", label: "Digest" },
  { id: "research", label: "Research" },
  { id: "coach", label: "Coach" },
  { id: "lab", label: "Lab" },
];

export function AppHeader(): JSX.Element {
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);

  return (
    <header className="ws-header">
      <div className="ws-header-left">
        <span className="brand">
          <Icon name="basis-logomark" size={20} />
          <span className="wordmark">Basis</span>
        </span>
      </div>

      <nav className="ws-tabs" role="tablist" aria-label="Views">
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
