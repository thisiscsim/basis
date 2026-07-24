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
  pricesProvider: "yahoo",
  tellerEnv: "sandbox",
  hasPricesKey: false,
  tellerLinked: false,
};

export function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const [tab, setTab] = useState<SettingsTab>("general");
  const [settings, setSettings] = useState<PublicSettings>(DEFAULTS);
  const [dataDir, setDataDir] = useState<string>("");
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
      ?.getDataDir()
      .then(setDataDir)
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
                title="Store your data in"
                sub={dataDir || "…"}
                subTitle="Click to reveal in Finder"
                onSubClick={() => void window.api.revealDataDir()}
              >
                <button className="settings-select-btn" onClick={() => void window.api.pickDataDir()}>
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
              <Divider />
              <SettingRow
                title="Price data"
                sub="Daily closes for drift, idea grading, and the Lab. Yahoo Finance is free with no key; Tiingo needs a free API token."
              >
                <SettingSelect
                  value={settings.pricesProvider}
                  onChange={(v) => void update({ pricesProvider: v as AppSettings["pricesProvider"] })}
                  options={[
                    { value: "yahoo", label: "Yahoo Finance (free, no key)" },
                    { value: "tiingo", label: "Tiingo (keyed)" },
                  ]}
                />
              </SettingRow>
              {settings.pricesProvider === "tiingo" && (
                <KeyRow
                  placeholder={
                    settings.hasPricesKey
                      ? "Tiingo token saved — enter a new one to replace it"
                      : "Enter your Tiingo API token"
                  }
                  onSave={(v) => void update({ pricesApiKey: v || undefined })}
                />
              )}
              <Divider />
              <SettingRow
                title="Bank sync (Teller, read-only)"
                sub={
                  settings.tellerLinked
                    ? "Bank linked. Sync from the Plan tab; unlink below."
                    : "Bring your own Teller application id (free developer tier: 100 connections; sandbox needs no certificate). Basis only ever reads balances and transactions — it can never move money."
                }
              >
                <SettingSelect
                  value={settings.tellerEnv}
                  onChange={(v) => void update({ tellerEnv: v as AppSettings["tellerEnv"] })}
                  options={[
                    { value: "sandbox", label: "Sandbox" },
                    { value: "development", label: "Development" },
                    { value: "production", label: "Production" },
                  ]}
                />
              </SettingRow>
              <KeyRow
                type="text"
                placeholder={settings.tellerAppId ? settings.tellerAppId : "Teller application id"}
                onSave={(v) => void update({ tellerAppId: v || undefined })}
              />
              {settings.tellerEnv !== "sandbox" && (
                <>
                  <KeyRow
                    type="text"
                    placeholder={settings.tellerCertPath ?? "Path to Teller client certificate (.pem)"}
                    onSave={(v) => void update({ tellerCertPath: v || undefined })}
                  />
                  <KeyRow
                    type="text"
                    placeholder={settings.tellerKeyPath ?? "Path to Teller private key (.pem)"}
                    onSave={(v) => void update({ tellerKeyPath: v || undefined })}
                  />
                </>
              )}
              {settings.tellerLinked && (
                <SettingRow
                  title="Linked bank enrollment"
                  sub="Drops the stored access token; revoke the enrollment itself from your bank or the Teller dashboard."
                >
                  <button
                    className="settings-select-btn"
                    onClick={async () => {
                      await window.api.tellerUnlink();
                      const next = await window.api.getSettings();
                      setSettings(next);
                    }}
                  >
                    Unlink
                  </button>
                </SettingRow>
              )}
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

/** Write-only secret input row: saved on Enter/click, never read back. */
function KeyRow({
  placeholder,
  onSave,
  type = "password",
}: {
  placeholder: string;
  onSave: (value: string) => void;
  type?: "password" | "text";
}): JSX.Element {
  const [draft, setDraft] = useState("");
  const save = () => {
    if (!draft.trim()) return;
    onSave(draft.trim());
    setDraft("");
  };
  return (
    <div className="settings-key-row">
      <input
        className="settings-key-input"
        type={type}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
      />
      <button className="settings-select-btn" onClick={save} disabled={!draft.trim()}>
        Save
      </button>
    </div>
  );
}

/** Gear button + modal in one — drop it into the app header. */
export function SettingsButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton icon="settings-gear" label="Settings" onClick={() => setOpen(true)} />
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}
