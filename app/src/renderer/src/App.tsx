import { type CSSProperties, memo, useEffect } from "react";
import { AppHeader } from "./components/AppHeader";
import { SideRail } from "./components/SideRail";
import { DigestView } from "./components/DigestView";
import { ResearchView } from "./components/ResearchView";
import { CoachView } from "./components/CoachView";
import { useApp, type AppTab, type Notice, type PanelId } from "./store";

// The shell re-renders on panel resize, notices, etc. These panels take no
// props and subscribe to the store themselves, so memoizing them keeps an App
// re-render (e.g. a per-pixel panel drag) from re-rendering all of them.
const AppHeaderM = memo(AppHeader);
const SideRailM = memo(SideRail);

export function App(): JSX.Element {
  const tab = useApp((s) => s.tab);
  const hasData = useApp((s) => s.data !== null);
  const loadError = useApp((s) => s.loadError);
  const notices = useApp((s) => s.notices);
  const dismissNotice = useApp((s) => s.dismissNotice);
  const setData = useApp((s) => s.setData);
  const setLoadError = useApp((s) => s.setLoadError);
  const setReload = useApp((s) => s.setReload);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const panelSizes = useApp((s) => s.panelSizes);

  // 'T' toggles light/dark anywhere, unless the user is typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "t" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
        return;
      toggleTheme();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTheme]);

  // Load (and live-reload) the data folder. The watcher fires when the
  // agent/engine scripts write files, so the UI always reflects disk truth.
  useEffect(() => {
    const load = () =>
      window.api
        ?.loadData()
        .then((res) => {
          if (res?.ok) {
            setData({
              dir: res.dir ?? null,
              portfolio: res.portfolio ?? { version: 1, currency: "USD", holdings: [] },
              ips: res.ips ?? { version: 1, goals: "", targetAllocation: [], rules: [] },
              watchlist: res.watchlist ?? { version: 1, entries: [] },
              alerts: res.alerts ?? { version: 1, alerts: [] },
              xray: res.xray ?? null,
              digest: res.digest ?? null,
              briefs: res.briefs ?? [],
            });
          } else {
            setLoadError(res?.error ?? "unknown error");
          }
        })
        .catch((err) => setLoadError(String(err)));
    setReload(load);
    void load();

    void window.api?.watchData();
    const off = window.api?.onDataChanged(() => {
      void load();
    });
    return () => off?.();
  }, [setData, setLoadError, setReload]);

  return (
    <>
      <div className="ws-shell" style={{ "--left-rail-w": `${panelSizes.left}px` } as CSSProperties}>
        <AppHeaderM />
        <div className="ws-main">
          <SideRailM />
          <PanelResizer panel="left" />
          <main className="ws-content">
            <TabBody tab={tab} />
          </main>
        </div>
        {!hasData && (
          <div className="boot">
            {loadError ? `Could not read your data folder: ${loadError}` : "Loading…"}
          </div>
        )}
      </div>
      {notices.length > 0 && (
        <div className="toast-stack" role="region" aria-label="Notifications">
          {notices.map((n) => (
            <Toast key={n.id} notice={n} onClose={() => dismissNotice(n.id)} />
          ))}
        </div>
      )}
    </>
  );
}

function TabBody({ tab }: { tab: AppTab }): JSX.Element {
  switch (tab) {
    case "digest":
      return <DigestView />;
    case "research":
      return <ResearchView />;
    case "coach":
      return <CoachView />;
    default: {
      const exhaustive: never = tab;
      return exhaustive;
    }
  }
}

/**
 * Slim drag handle between the rail and the content; clamped in the store
 * (PANEL_LIMITS) and persisted to localStorage on release.
 */
function PanelResizer({ panel }: { panel: PanelId }): JSX.Element {
  const setPanelSize = useApp((s) => s.setPanelSize);

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = useApp.getState().panelSizes[panel];
    const el = e.currentTarget;
    el.classList.add("active");
    document.body.style.cursor = "col-resize";

    // rAF-coalesce moves: at most one store update per frame; localStorage is
    // persisted once on mouseup.
    let raf = 0;
    let last = start;
    const apply = () => {
      raf = 0;
      setPanelSize(panel, last, false); // don't touch localStorage mid-drag
    };
    const onMove = (ev: MouseEvent) => {
      last = start + (ev.clientX - startX);
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (raf) cancelAnimationFrame(raf);
      setPanelSize(panel, last); // persist once on release
      el.classList.remove("active");
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className="panel-resizer vertical"
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
    />
  );
}

function Toast({ notice, onClose }: { notice: Notice; onClose: () => void }): JSX.Element {
  // Errors persist until dismissed; info auto-dismisses. Keyed on notice.id at
  // the call site, so an App re-render doesn't restart the timer.
  useEffect(() => {
    if (notice.kind === "error") return;
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [notice.kind, onClose]);
  return (
    <div className={`toast toast-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
      <span className="toast-text">{notice.text}</span>
      <button className="toast-close" onClick={onClose} aria-label="Dismiss" title="Dismiss">
        ×
      </button>
    </div>
  );
}
