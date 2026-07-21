import { useState } from "react";
import { useApp } from "../store";
import { runJob } from "../lib/jobs";
import { Button, Icon } from "./ui";
import { IpsModal, PortfolioModal } from "./editors";

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,11}$/;

export function WorkspaceRail(): JSX.Element {
  const ws = useApp((s) => s.ws);
  const slug = useApp((s) => s.slug);
  const saveWatchlist = useApp((s) => s.saveWatchlist);
  const pushNotice = useApp((s) => s.pushNotice);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<"portfolio" | "ips" | null>(null);

  if (!ws || !slug) return <aside className="left-rail" />;

  const addTicker = async () => {
    const ticker = draft.toUpperCase().trim();
    if (!ticker) return;
    if (!TICKER_RE.test(ticker)) {
      pushNotice("error", `"${ticker}" doesn't look like a ticker symbol.`);
      return;
    }
    if (ws.watchlist.entries.some((e) => e.ticker === ticker)) {
      setDraft("");
      return;
    }
    setDraft("");
    await saveWatchlist({
      ...ws.watchlist,
      entries: [...ws.watchlist.entries, { ticker, addedAt: new Date().toISOString() }],
    });
  };

  const removeTicker = (ticker: string) =>
    saveWatchlist({
      ...ws.watchlist,
      entries: ws.watchlist.entries.filter((e) => e.ticker !== ticker),
    });

  return (
    <aside className="left-rail">
      <section className="rail-section">
        <div className="rail-head">
          <Icon name="folder-alt" size={14} />
          Watchlist
        </div>
        <div className="rail-body">
          <div className="url-row">
            <input
              className="url-input"
              type="text"
              placeholder="Add ticker (e.g. AAPL)"
              value={draft}
              onChange={(e) => setDraft(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && void addTicker()}
            />
            <Button variant="secondary" size="sm" onClick={() => void addTicker()} disabled={!draft.trim()}>
              Add
            </Button>
          </div>
          {ws.watchlist.entries.length > 0 && (
            <div className="clip-list clip-list-capped">
              {ws.watchlist.entries.map((e) => (
                <div key={e.ticker} className="clip-row" title={e.name ?? e.ticker}>
                  <span className="name">
                    {e.ticker}
                    {e.name ? <span className="muted"> — {e.name}</span> : null}
                  </span>
                  <button
                    className="clip-row-remove"
                    title="Remove from watchlist"
                    aria-label={`Remove ${e.ticker}`}
                    onClick={() => void removeTicker(e.ticker)}
                  >
                    <Icon name="trash-can" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="rail-section">
        <div className="rail-head">
          <Icon name="form-square" size={14} />
          Portfolio
        </div>
        <div className="rail-body">
          <p className="rail-note">
            {ws.portfolio.holdings.length === 0
              ? "No holdings entered yet."
              : `${ws.portfolio.holdings.length} holding${ws.portfolio.holdings.length === 1 ? "" : "s"}: ${ws.portfolio.holdings
                  .slice(0, 6)
                  .map((h) => h.ticker)
                  .join(", ")}${ws.portfolio.holdings.length > 6 ? "…" : ""}`}
          </p>
          <Button variant="secondary" size="sm" icon="input-form" onClick={() => setEditing("portfolio")}>
            Edit holdings
          </Button>
        </div>
      </section>

      <section className="rail-section">
        <div className="rail-head">
          <Icon name="prompt" size={14} />
          Investment Policy
        </div>
        <div className="rail-body">
          <p className="rail-note">
            {ws.ips.rules.length === 0
              ? "No rules written yet — the coach argues from these."
              : `${ws.ips.rules.length} rule${ws.ips.rules.length === 1 ? "" : "s"} on record.`}
          </p>
          <Button variant="secondary" size="sm" icon="input-form" onClick={() => setEditing("ips")}>
            Edit IPS
          </Button>
        </div>
      </section>

      <section className="rail-section">
        <div className="rail-head">
          <Icon name="magic-wand" size={14} />
          Agent
        </div>
        <div className="rail-body">
          <JobButton
            job="monitor"
            label="Update filings"
            icon="arrow-rotate"
            disabled={ws.watchlist.entries.length === 0}
            disabledHint="Add tickers to the watchlist first"
            onRun={() => runJob("monitor", () => window.api.startMonitor(slug))}
          />
          <JobButton
            job="xray"
            label="Run portfolio X-ray"
            icon="form-rectangle"
            disabled={ws.portfolio.holdings.length === 0}
            disabledHint="Enter holdings first"
            onRun={() => runJob("xray", () => window.api.startXray(slug))}
          />
          <JobButton
            job="digest"
            label="Build digest"
            icon="clapboard-sparkle"
            disabled={ws.alerts.alerts.length === 0 && !ws.xray}
            disabledHint="Update filings or run the X-ray first"
            onRun={() => runJob("digest", () => window.api.startDigest(slug))}
          />
        </div>
      </section>

      {editing === "portfolio" && <PortfolioModal onClose={() => setEditing(null)} />}
      {editing === "ips" && <IpsModal onClose={() => setEditing(null)} />}
    </aside>
  );
}

function JobButton({
  job,
  label,
  icon,
  disabled,
  disabledHint,
  onRun,
}: {
  job: "monitor" | "xray" | "digest";
  label: string;
  icon: "arrow-rotate" | "form-rectangle" | "clapboard-sparkle";
  disabled?: boolean;
  disabledHint?: string;
  onRun: () => Promise<boolean>;
}): JSX.Element {
  const state = useApp((s) => s.jobs[job]);
  return (
    <div className="job-row" title={disabled ? disabledHint : undefined}>
      <Button
        variant="secondary"
        size="sm"
        icon={icon}
        disabled={disabled || state.running}
        onClick={() => void onRun()}
      >
        {state.running ? state.phase || "Working…" : label}
      </Button>
      {state.running && (
        <div className="bar job-bar" aria-hidden>
          <div className="bar-fill" style={{ width: `${state.progress}%` }} />
        </div>
      )}
    </div>
  );
}
