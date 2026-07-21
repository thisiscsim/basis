import { useState } from "react";
import type { Alert } from "@basis/schema";
import { useApp } from "../store";
import { relativeTime } from "../lib/time";
import { Badge, Button, Icon } from "./ui";

/** Digest surface: latest digest, portfolio x-ray, and the filing-alert inbox. */
export function DigestView(): JSX.Element {
  const data = useApp((s) => s.data);
  if (!data) return <div className="surface" />;

  const unread = data.alerts.alerts.filter((a) => !a.read).length;

  return (
    <div className="surface">
      <DigestCard />
      <XrayCard />

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Filing alerts</h2>
          {unread > 0 && <MarkAllRead />}
        </div>
        {data.alerts.alerts.length === 0 ? (
          <p className="empty-note">
            Nothing yet. Add tickers to the watchlist and run <strong>Update filings</strong> — new SEC
            filings land here, with "what changed" summaries when a model is configured.
          </p>
        ) : (
          <div className="alert-list">
            {data.alerts.alerts.slice(0, 50).map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DigestCard(): JSX.Element {
  const digest = useApp((s) => s.data?.digest ?? null);

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Digest</h2>
        {digest && (
          <span className="card-head-meta">
            {digest.periodLabel ?? ""}
            {digest.generatedBy === "deterministic" && (
              <Badge variant="neutral">no model — filings list only</Badge>
            )}
          </span>
        )}
      </div>
      {!digest ? (
        <p className="empty-note">
          No digest yet. After updating filings, run <strong>Build digest</strong> for a short "what happened
          and why it matters" readout.
        </p>
      ) : (
        <>
          {digest.bullets.map((b, i) => (
            <div key={i} className="digest-bullet">
              <div className="digest-bullet-title">
                {b.title}
                {b.tickers.map((t) => (
                  <Badge key={t} variant="accent">
                    {t}
                  </Badge>
                ))}
              </div>
              {b.body && <p className="digest-bullet-body">{b.body}</p>}
            </div>
          ))}
          {digest.portfolioNote && <p className="digest-portfolio-note">{digest.portfolioNote}</p>}
          <p className="disclaimer">
            Generated from public filings. Not investment advice; verify anything load-bearing at the source.
          </p>
        </>
      )}
    </section>
  );
}

function XrayCard(): JSX.Element {
  const xray = useApp((s) => s.data?.xray ?? null);

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Portfolio X-ray</h2>
        {xray?.generatedAt && <span className="card-head-meta">{relativeTime(xray.generatedAt)}</span>}
      </div>
      {!xray ? (
        <p className="empty-note">
          Enter holdings, then run the X-ray to see what you're actually exposed to — sector concentration,
          correlated bets, single-position risk.
        </p>
      ) : (
        <>
          {xray.weighting === "equal" && (
            <p className="muted small">Holdings weighted equally (no weights/cost basis entered).</p>
          )}
          <div className="meter-list">
            {xray.bySector.slice(0, 8).map((g) => (
              <div key={g.label} className="meter-row" title={g.tickers.join(", ")}>
                <span className="meter-label">{g.label}</span>
                <span className="meter">
                  <span
                    className={`meter-fill ${g.pct > 40 ? "warn" : ""}`}
                    style={{ width: `${Math.min(g.pct, 100)}%` }}
                  />
                </span>
                <span className="meter-pct">{Math.round(g.pct)}%</span>
              </div>
            ))}
          </div>
          <div className="xray-stats">
            <span>Top position ~{Math.round(xray.concentration.top1Pct)}%</span>
            <span>Top 5 ~{Math.round(xray.concentration.top5Pct)}%</span>
            <span>Largest sector ~{Math.round(xray.concentration.sectorMaxPct)}%</span>
          </div>
          {xray.drift.length > 0 && (
            <div className="drift-block">
              <h3 className="drift-title">Drift vs your IPS targets</h3>
              <div className="meter-list">
                {xray.drift.map((d) => (
                  <div
                    key={d.label}
                    className="meter-row"
                    title={`Target ${d.targetPct}% / actual ${d.actualPct}%`}
                  >
                    <span className="meter-label">{d.label}</span>
                    <span className="meter drift-meter">
                      <span
                        className="meter-target"
                        style={{ left: `${Math.min(d.targetPct, 100)}%` }}
                        aria-hidden
                      />
                      <span
                        className={`meter-fill ${Math.abs(d.driftPct) > 5 ? "warn" : ""}`}
                        style={{ width: `${Math.min(d.actualPct, 100)}%` }}
                      />
                    </span>
                    <span className={`meter-pct ${Math.abs(d.driftPct) > 5 ? "drift-off" : ""}`}>
                      {d.driftPct > 0 ? "+" : ""}
                      {d.driftPct}
                    </span>
                  </div>
                ))}
              </div>
              {(() => {
                const worst = [...xray.drift].sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct))[0];
                if (!worst || Math.abs(worst.driftPct) <= 5) {
                  return <p className="muted small">Within your 5-point band. Nothing to do.</p>;
                }
                const over = xray.drift.filter((d) => d.driftPct > 5).map((d) => d.label);
                const under = xray.drift.filter((d) => d.driftPct < -5).map((d) => d.label);
                return (
                  <p className="muted small">
                    To get back to target, future contributions (or a rebalance) would shift ~
                    {Math.abs(worst.driftPct)} pts
                    {over.length > 0 && under.length > 0
                      ? ` from ${over.join(", ")} toward ${under.join(", ")}`
                      : ""}
                    . Informational only — Basis never executes trades.
                  </p>
                );
              })()}
            </div>
          )}
          {xray.warnings.length > 0 && (
            <ul className="xray-warnings">
              {xray.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {xray.narrative && <p className="xray-narrative">{xray.narrative}</p>}
        </>
      )}
    </section>
  );
}

function MarkAllRead(): JSX.Element {
  const data = useApp((s) => s.data);
  const saveAlerts = useApp((s) => s.saveAlerts);
  if (!data) return <span />;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() =>
        void saveAlerts({ ...data.alerts, alerts: data.alerts.alerts.map((a) => ({ ...a, read: true })) })
      }
    >
      Mark all read
    </Button>
  );
}

function AlertRow({ alert }: { alert: Alert }): JSX.Element {
  const data = useApp((s) => s.data);
  const saveAlerts = useApp((s) => s.saveAlerts);
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    setExpanded((v) => !v);
    if (!alert.read && data) {
      void saveAlerts({
        ...data.alerts,
        alerts: data.alerts.alerts.map((a) => (a.id === alert.id ? { ...a, read: true } : a)),
      });
    }
  };

  return (
    <div className={`alert-row ${alert.read ? "" : "unread"}`}>
      <button className="alert-row-main" onClick={toggle} aria-expanded={expanded}>
        <Badge variant="accent">{alert.ticker}</Badge>
        <span className="alert-form">{alert.form}</span>
        <span className="alert-title">{alert.title}</span>
        <span className="alert-date">{alert.filedAt}</span>
      </button>
      {expanded && (
        <div className="alert-detail">
          {alert.summary ? (
            <p className="alert-summary">{alert.summary}</p>
          ) : (
            <p className="muted small">
              No change summary yet — it's written during <strong>Update filings</strong> when a model is
              configured.
            </p>
          )}
          {alert.url && (
            <button className="citation-link" onClick={() => void window.api.openExternal(alert.url!)}>
              <Icon name="share-os" size={12} />
              View filing on sec.gov
            </button>
          )}
        </div>
      )}
    </div>
  );
}
