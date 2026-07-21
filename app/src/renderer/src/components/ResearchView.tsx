import { useEffect, useState } from "react";
import type { Brief, GraphEdge } from "@basis/schema";
import { useApp } from "../store";
import { runJob } from "../lib/jobs";
import { relativeTime } from "../lib/time";
import { Badge, Button, Icon } from "./ui";

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,11}$/;

/**
 * Research surface: generate due-diligence briefs (every claim carries a
 * verified citation) and read them with a sources rail.
 */
export function ResearchView(): JSX.Element {
  const data = useApp((s) => s.data);
  const openBriefFile = useApp((s) => s.openBriefFile);
  const openBrief = useApp((s) => s.openBrief);
  const setOpenBrief = useApp((s) => s.setOpenBrief);
  const briefJob = useApp((s) => s.jobs.brief);
  const pushNotice = useApp((s) => s.pushNotice);
  const [ticker, setTicker] = useState("");

  // Auto-open the newest brief when none is selected (e.g. right after generation).
  const newest = data?.briefs[0]?.file ?? null;
  useEffect(() => {
    if (openBriefFile || !newest) return;
    let alive = true;
    window.api
      ?.loadBrief(newest)
      .then((b) => alive && b && useApp.getState().setOpenBrief(newest, b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [newest, openBriefFile]);

  if (!data) return <div className="surface" />;

  const generate = async () => {
    const t = ticker.toUpperCase().trim();
    if (!TICKER_RE.test(t)) {
      pushNotice("error", `"${ticker}" doesn't look like a ticker symbol.`);
      return;
    }
    setTicker("");
    setOpenBrief(null, null); // the effect opens the fresh brief after reload
    await runJob("brief", () => window.api.startBrief(t));
  };

  const open = async (file: string) => {
    const brief = await window.api.loadBrief(file);
    if (brief) setOpenBrief(file, brief);
    else pushNotice("error", "Couldn't read that brief (invalid or missing file).");
  };

  return (
    <div className="research">
      <aside className="research-list">
        <div className="research-compose">
          <input
            className="url-input"
            type="text"
            placeholder="Ticker (e.g. BFLY)"
            value={ticker}
            disabled={briefJob.running}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && void generate()}
          />
          <Button
            variant="primary"
            size="sm"
            icon="magic-wand"
            disabled={briefJob.running || !ticker.trim()}
            onClick={() => void generate()}
          >
            {briefJob.running ? briefJob.phase || "Working…" : "New brief"}
          </Button>
        </div>
        {briefJob.running && (
          <div className="bar job-bar" aria-hidden>
            <div className="bar-fill" style={{ width: `${briefJob.progress}%` }} />
          </div>
        )}
        {data.briefs.length === 0 ? (
          <p className="empty-note">
            No briefs yet. A brief is a structured read of the company's own SEC filings — business model,
            financial trends, competition, the bear case, red flags — with every claim quoting its source.
          </p>
        ) : (
          <div className="brief-list">
            {data.briefs.map((b) => (
              <button
                key={b.file}
                className={`brief-item ${openBriefFile === b.file ? "active" : ""}`}
                onClick={() => void open(b.file)}
              >
                <span className="brief-item-ticker">{b.ticker}</span>
                <span className="brief-item-meta">
                  {b.company ?? ""}
                  {b.generatedAt ? ` · ${relativeTime(b.generatedAt) ?? ""}` : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <div className="brief-view">
        {openBrief ? <BriefReader brief={openBrief} /> : <EmptyBrief hasAny={data.briefs.length > 0} />}
      </div>
    </div>
  );
}

function EmptyBrief({ hasAny }: { hasAny: boolean }): JSX.Element {
  return (
    <div className="brief-empty">
      <Icon name="prompt" size={24} />
      <p>{hasAny ? "Select a brief on the left." : "Generate your first brief to get started."}</p>
    </div>
  );
}

function BriefReader({ brief }: { brief: Brief }): JSX.Element {
  return (
    <article className="brief">
      <header className="brief-header">
        <h1>
          {brief.company ?? brief.ticker} <Badge variant="accent">{brief.ticker}</Badge>
        </h1>
        <p className="muted small">
          {brief.model ? `Written by ${brief.model}` : ""}
          {brief.generatedAt ? ` · ${new Date(brief.generatedAt).toLocaleDateString()}` : ""}
          {brief.droppedClaims > 0
            ? ` · ${brief.droppedClaims} claim${brief.droppedClaims === 1 ? "" : "s"} dropped by citation check`
            : ""}
        </p>
      </header>

      {brief.summary && <p className="brief-summary">{brief.summary}</p>}

      {brief.sections.map((section) => (
        <section key={section.key} className="brief-section">
          <h2>{section.label}</h2>
          {section.claims.map((claim, i) => (
            <div key={i} className="claim">
              <p className="claim-text">{claim.text}</p>
              <blockquote className="claim-quote">
                "{claim.quote}"
                <button
                  className="citation-link"
                  title={claim.sourceUrl}
                  onClick={() => void window.api.openExternal(claim.sourceUrl)}
                >
                  <Icon name="share-os" size={12} />
                  {claim.source}
                </button>
              </blockquote>
            </div>
          ))}
        </section>
      ))}

      <Connections ticker={brief.ticker} />

      {brief.sources.length > 0 && (
        <footer className="brief-sources">
          <h2>Sources</h2>
          {brief.sources.map((s) => (
            <button
              key={s.url}
              className="citation-link"
              title={s.url}
              onClick={() => void window.api.openExternal(s.url)}
            >
              <Icon name="share-os" size={12} />
              {s.title ?? s.url}
            </button>
          ))}
        </footer>
      )}
      <p className="disclaimer">
        Every claim above passed an exact-quote check against the filing text; anything that failed was
        dropped. This is public information already priced in by professionals — a "did you actually check?"
        gate, not an edge. Not investment advice.
      </p>
    </article>
  );
}

/**
 * Knowledge-graph edges touching this ticker (filer-side or counterparty),
 * each backed by a verified verbatim quote. Coverage, not edge.
 */
function Connections({ ticker }: { ticker: string }): JSX.Element | null {
  const edges = useApp((s) => s.data?.graph.edges ?? []);
  const relevant = edges.filter((e) => e.from === ticker || e.toTicker === ticker).slice(0, 12);
  if (relevant.length === 0) return null;
  return (
    <section className="brief-section">
      <h2>Connections</h2>
      {relevant.map((edge) => (
        <ConnectionRow key={edge.id} edge={edge} perspective={ticker} />
      ))}
      <p className="muted small">
        Extracted from filings by the agent during Update filings; every edge's quote was verified verbatim
        against the source before being shown.
      </p>
    </section>
  );
}

const REL_LABELS: Record<GraphEdge["rel"], string> = {
  supplier: "supplier",
  customer: "customer",
  partner: "partner",
  competitor: "competitor",
  investor: "investor",
  subsidiary: "subsidiary",
  other: "related",
};

function ConnectionRow({ edge, perspective }: { edge: GraphEdge; perspective: string }): JSX.Element {
  const isFiler = edge.from === perspective;
  return (
    <div className="claim">
      <p className="claim-text">
        {isFiler ? (
          <>
            <Badge variant="neutral">{REL_LABELS[edge.rel]}</Badge> {edge.to}
            {edge.toTicker ? ` (${edge.toTicker})` : ""}
          </>
        ) : (
          <>
            <Badge variant="neutral">{REL_LABELS[edge.rel]}</Badge> named by {edge.from} — {edge.to}
          </>
        )}
      </p>
      <blockquote className="claim-quote">
        "{edge.quote}"
        <button
          className="citation-link"
          title={edge.sourceUrl}
          onClick={() => void window.api.openExternal(edge.sourceUrl)}
        >
          <Icon name="share-os" size={12} />
          {edge.source}
        </button>
      </blockquote>
    </div>
  );
}
