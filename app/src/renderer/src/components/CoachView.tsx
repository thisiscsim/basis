import { useEffect, useRef, useState } from "react";
import { useApp, type ChatEntry } from "../store";
import { Badge, Button, Icon } from "./ui";

type Mode = "tutor" | "coach";

/**
 * Coach surface: streaming chat (tutor for learning, coach for holding the
 * user to their own IPS) plus the pre-trade friction gate.
 */
export function CoachView(): JSX.Element {
  const chat = useApp((s) => s.chat);
  const streaming = useApp((s) => s.chatStreaming);
  const clearChat = useApp((s) => s.clearChat);
  const pushNotice = useApp((s) => s.pushNotice);
  const [mode, setMode] = useState<Mode>("coach");
  const [draft, setDraft] = useState("");
  const [gateOpen, setGateOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stream plumbing: deltas append to the pending assistant message.
  useEffect(() => {
    const offDelta = window.api?.onChatDelta((delta) => useApp.getState().appendChatDelta(delta));
    const offDone = window.api?.onChatDone((text) => useApp.getState().finishChatMessage(text));
    const offError = window.api?.onChatError((message) => {
      useApp.getState().setChatStreaming(false);
      useApp.getState().pushNotice("error", `Chat failed: ${message}`);
    });
    return () => {
      offDelta?.();
      offDone?.();
      offError?.();
    };
  }, []);

  // Keep the newest message in view while streaming.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat]);

  const send = async () => {
    const content = draft.trim();
    if (!content || streaming) return;
    setDraft("");
    const state = useApp.getState();
    state.appendChat({ role: "user", content });
    state.setChatStreaming(true);
    const messages = useApp
      .getState()
      .chat.filter((m) => !m.pending)
      .map(({ role, content: c }) => ({ role, content: c }));
    const res = await window.api.sendChat({ mode, messages });
    if (!res.ok && !res.cancelled) {
      useApp.getState().setChatStreaming(false);
      if (res.error) pushNotice("error", res.error);
    }
    if (res.ok) useApp.getState().setChatStreaming(false);
  };

  return (
    <div className="coach">
      <div className="coach-toolbar">
        <div className="seg-tabs" role="tablist" aria-label="Chat mode">
          <button
            role="tab"
            aria-selected={mode === "coach"}
            className={`ws-tab ${mode === "coach" ? "active" : ""}`}
            onClick={() => setMode("coach")}
            title="Argues from your own IPS and portfolio"
          >
            Coach
          </button>
          <button
            role="tab"
            aria-selected={mode === "tutor"}
            className={`ws-tab ${mode === "tutor" ? "active" : ""}`}
            onClick={() => setMode("tutor")}
            title="A patient investing tutor — ask anything"
          >
            Tutor
          </button>
        </div>
        <div className="coach-toolbar-right">
          <Button variant="secondary" size="sm" icon="record" onClick={() => setGateOpen(true)}>
            I'm about to trade…
          </Button>
          {chat.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearChat} disabled={streaming}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {chat.length === 0 ? (
          <div className="chat-empty">
            <Icon name="circle-questionmark" size={24} />
            {mode === "tutor" ? (
              <p>
                Ask anything: "What does P/E actually mean?", "Why do bond prices fall when rates rise?",
                "Explain expense ratios like I'm smart but new."
              </p>
            ) : (
              <p>
                The coach knows your IPS, holdings, and X-ray. Try: "Does my portfolio match my rules?" — or
                use <strong>I'm about to trade…</strong> before an impulsive move.
              </p>
            )}
          </div>
        ) : (
          chat.map((m, i) => <ChatBubble key={i} entry={m} />)
        )}
      </div>

      <div className="chat-composer">
        <textarea
          className="chat-input"
          rows={2}
          placeholder={mode === "tutor" ? "Ask the tutor anything…" : "Talk to your coach…"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {streaming ? (
          <Button variant="secondary" size="sm" onClick={() => void window.api.cancelChat()}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => void send()} disabled={!draft.trim()}>
            Send
          </Button>
        )}
      </div>

      {gateOpen && <GateDialog onClose={() => setGateOpen(false)} />}
    </div>
  );
}

function ChatBubble({ entry }: { entry: ChatEntry }): JSX.Element {
  return (
    <div className={`chat-msg ${entry.role}`}>
      <div className="chat-msg-body">
        {entry.content}
        {entry.pending && <span className="chat-cursor" aria-hidden />}
      </div>
    </div>
  );
}

/**
 * The friction gate: describe the trade, get an argument from your own rules,
 * then record what you decided — either way it lands in the decision log so
 * you can review your own track record honestly.
 */
function GateDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const pushNotice = useApp((s) => s.pushNotice);
  const [trade, setTrade] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ verdict: string; argument: string } | null>(null);

  const evaluate = async () => {
    if (!trade.trim() || busy) return;
    setBusy(true);
    try {
      const res = await window.api.evaluateGate(trade.trim());
      if (res.ok && res.argument) {
        setResult({ verdict: res.verdict ?? "unclear", argument: res.argument });
      } else {
        pushNotice("error", res.error ?? "Could not evaluate the trade.");
      }
    } finally {
      setBusy(false);
    }
  };

  const record = async (verdict: "proceeded" | "cancelled") => {
    await window.api.recordDecision({
      trade: trade.trim(),
      verdict,
      argument: result?.argument,
    });
    pushNotice(
      "info",
      verdict === "cancelled"
        ? "Logged: you held off. Future-you says thanks."
        : "Logged. It's your money — track how these calls go.",
    );
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gate-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="gate-title">Before you trade</h2>
        {!result ? (
          <>
            <p className="muted small">
              Describe the trade. The coach checks it against your own IPS — the rules you wrote when you were
              calm.
            </p>
            <textarea
              className="chat-input"
              rows={3}
              autoFocus
              placeholder='e.g. "Sell 40 shares of AAPL — it dropped 9% this week"'
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
            />
            <div className="gate-actions">
              <Button variant="secondary" onClick={onClose}>
                Never mind
              </Button>
              <Button variant="primary" disabled={!trade.trim() || busy} onClick={() => void evaluate()}>
                {busy ? "Checking your rules…" : "Check against my IPS"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="gate-verdict">
              <Badge variant={result.verdict === "consistent" ? "accent" : "neutral"}>
                {result.verdict === "consistent"
                  ? "Consistent with your IPS"
                  : result.verdict === "inconsistent"
                    ? "Breaks your own rules"
                    : "Unclear — your IPS doesn't cover this"}
              </Badge>
            </div>
            <p className="gate-argument">{result.argument}</p>
            <p className="muted small">
              Either way, this gets logged so you can review your own track record.
            </p>
            <div className="gate-actions">
              <Button variant="primary" onClick={() => void record("cancelled")}>
                You're right — hold off
              </Button>
              <Button variant="secondary" onClick={() => void record("proceeded")}>
                Proceeding anyway
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
