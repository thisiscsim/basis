import { useEffect, useState } from "react";
import { useApp } from "../store";
import { Button, IconButton } from "./ui";
import { useEscapeKey } from "./ui/useEscapeKey";
import { Divider, modelLabel, SettingRow, SettingSelect } from "./settings/controls";
import type { AppSettings, PublicSettings } from "../../../preload";

type SettingsTab = "general" | "agent" | "data";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "agent", label: "Agent Preferences" },
  { id: "data", label: "Data Sources" },
];

const MODELS = ["gpt-5.5", "gpt-5.5-mini", "claude-fable-5", "claude-sonnet-5"];

const DEFAULTS: PublicSettings = {
  agentModel: "gpt-5.5",
  reasoningEffort: "low",
  hasAgentKey: false,
};

export function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const [tab, setTab] = useState<SettingsTab>("general");
  const [settings, setSettings] = useState<PublicSettings>(DEFAULTS);
  const [workspacesDir, setWorkspacesDir] = useState<string>("");
  const [locks, setLocks] = useState({ modelLocked: false, keyLocked: false });
  const [keyDraft, setKeyDraft] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [contactDraft, setContactDraft] = useState<string | null>(null);

  useEscapeKey(onClose);

  useEffect(() => {
    window.api
      ?.getSettings()
      .then(setSettings)
      .catch(() => {});
    window.api
      ?.getWorkspacesDir()
      .then(setWorkspacesDir)
      .catch(() => {});
    window.api
      ?.llmInfo()
      .then((m) => setLocks({ modelLocked: m.modelLocked, keyLocked: m.keyLocked }))
      .catch(() => {});
  }, []);

  const update = async (patch: Partial<AppSettings>) => {
    const next = await window.api.setSettings(patch);
    setSettings(next);
  };

  const connectKey = async () => {
    if (!keyDraft.trim()) return;
    await update({ agentApiKey: keyDraft.trim() });
    setKeyDraft("");
    setKeySaved(true);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-tabs-row">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`settings-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {tab === "general" && (
            <>
              <SettingRow title="Appearance" sub="Select your interface color scheme">
                <SettingSelect
                  value={theme}
                  onChange={(v) => setTheme(v as "light" | "dark")}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                />
              </SettingRow>
              <Divider />
              <SettingRow
                title="Save all workspaces to"
                sub={workspacesDir || "…"}
                subTitle="Click to reveal in Finder"
                onSubClick={() => void window.api.revealWorkspacesDir()}
              >
                <button className="settings-select-btn" onClick={() => void window.api.pickWorkspacesDir()}>
                  Change directory
                </button>
              </SettingRow>
            </>
          )}

          {tab === "agent" && (
            <>
              <SettingRow
                title="Model"
                sub={
                  locks.modelLocked
                    ? "Pinned by BASIS_LLM_MODEL in .env.local"
                    : "Model used for briefs, digests, chat, and the friction gate"
                }
              >
                <SettingSelect
                  value={settings.agentModel}
                  onChange={(v) => void update({ agentModel: v })}
                  disabled={locks.modelLocked}
                  options={MODELS.map((m) => ({ value: m, label: modelLabel(m) }))}
                />
              </SettingRow>
              <div className="settings-key-row">
                <input
                  className="settings-key-input"
                  type="password"
                  placeholder={
                    locks.keyLocked
                      ? "API key configured via .env.local"
                      : keySaved || settings.hasAgentKey
                        ? "API key saved — enter a new key to replace it"
                        : "Enter your OpenAI API Key"
                  }
                  value={keyDraft}
                  disabled={locks.keyLocked}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void connectKey()}
                />
                <button
                  className="settings-select-btn"
                  onClick={() => void connectKey()}
                  disabled={locks.keyLocked || !keyDraft.trim()}
                >
                  {keySaved ? "Saved" : "Connect"}
                </button>
              </div>
              <Divider />
              <SettingRow title="Reasoning effort" sub="Higher effort thinks longer and costs more per run">
                <SettingSelect
                  value={settings.reasoningEffort}
                  onChange={(v) => void update({ reasoningEffort: v as AppSettings["reasoningEffort"] })}
                  options={[
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                  ]}
                />
              </SettingRow>
            </>
          )}

          {tab === "data" && (
            <>
              <SettingRow
                title="SEC EDGAR contact"
                sub="EDGAR's fair-access policy asks for a contact email in the request User-Agent. Free; no account needed."
              >
                <span />
              </SettingRow>
              <div className="settings-key-row">
                <input
                  className="settings-key-input"
                  type="email"
                  placeholder="you@example.com"
                  value={contactDraft ?? settings.edgarContact ?? ""}
                  onChange={(e) => setContactDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && contactDraft !== null) {
                      void update({ edgarContact: contactDraft.trim() || undefined });
                      setContactDraft(null);
                    }
                  }}
                />
                <button
                  className="settings-select-btn"
                  disabled={contactDraft === null}
                  onClick={() => {
                    if (contactDraft === null) return;
                    void update({ edgarContact: contactDraft.trim() || undefined });
                    setContactDraft(null);
                  }}
                >
                  Save
                </button>
              </div>
            </>
          )}
        </div>

        <div className="settings-footer">
          <Button variant="primary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Gear button + modal in one — drop it into any bar (Home, workspace header). */
export function SettingsButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton icon="settings-gear" label="Settings" onClick={() => setOpen(true)} />
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}
