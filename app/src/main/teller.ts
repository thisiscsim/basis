import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { BrowserWindow } from "electron";

/**
 * Read-only Teller client. The user supplies their own Teller application id
 * (free developer tier covers 100 live connections); Basis talks to
 * api.teller.io directly. Only accounts/balances/transactions are ever
 * called — Teller's payment capability is never used.
 *
 * Sandbox needs no client certificate; development/production use the
 * Teller-issued cert+key (paths configured in Settings, loaded here,
 * never bundled). Plain node:https so mTLS works without extra deps.
 */

export type TellerEnv = "sandbox" | "development" | "production";

export interface TellerConfig {
  applicationId: string;
  env: TellerEnv;
  certPath?: string;
  keyPath?: string;
}

export interface TellerAccount {
  id: string;
  name: string;
  type: string; // depository | credit
  subtype: string; // checking | savings | credit_card | ...
  institution?: { name?: string };
}

export interface TellerBalance {
  account_id: string;
  ledger: string;
  available?: string | null;
}

export interface TellerTransaction {
  id: string;
  account_id: string;
  date: string;
  amount: string;
  description?: string;
  status?: string;
  details?: { counterparty?: { name?: string | null } | null; category?: string | null };
}

function tellerGet<T>(cfg: TellerConfig, accessToken: string, path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let cert: Buffer | undefined;
    let key: Buffer | undefined;
    if (cfg.env !== "sandbox") {
      try {
        if (cfg.certPath) cert = readFileSync(cfg.certPath);
        if (cfg.keyPath) key = readFileSync(cfg.keyPath);
      } catch (err) {
        reject(new Error(`could not read the Teller client certificate: ${String(err)}`));
        return;
      }
      if (!cert || !key) {
        reject(
          new Error("Teller development/production needs the client certificate + key paths in Settings."),
        );
        return;
      }
    }
    const req = httpsRequest(
      {
        host: "api.teller.io",
        path,
        method: "GET",
        // HTTP Basic: access token as username, empty password.
        auth: `${accessToken}:`,
        headers: { Accept: "application/json" },
        cert,
        key,
        timeout: 30_000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body) as T);
            } catch (err) {
              reject(new Error(`Teller returned unparsable JSON: ${String(err)}`));
            }
          } else {
            let message = `Teller HTTP ${res.statusCode}`;
            try {
              message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? message;
            } catch {
              // keep the status-code message
            }
            reject(new Error(message));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Teller request timed out")));
    req.on("error", reject);
    req.end();
  });
}

export function fetchAccounts(cfg: TellerConfig, token: string): Promise<TellerAccount[]> {
  return tellerGet<TellerAccount[]>(cfg, token, "/accounts");
}

export function fetchBalance(cfg: TellerConfig, token: string, accountId: string): Promise<TellerBalance> {
  return tellerGet<TellerBalance>(cfg, token, `/accounts/${encodeURIComponent(accountId)}/balances`);
}

export function fetchTransactions(
  cfg: TellerConfig,
  token: string,
  accountId: string,
  count = 250,
): Promise<TellerTransaction[]> {
  return tellerGet<TellerTransaction[]>(
    cfg,
    token,
    `/accounts/${encodeURIComponent(accountId)}/transactions?count=${count}`,
  );
}

export interface ConnectResult {
  ok: boolean;
  accessToken?: string;
  cancelled?: boolean;
  error?: string;
}

// The page signals its result by navigating to this fake origin; main
// intercepts the navigation, so no extra preload/IPC surface is needed.
const RESULT_ORIGIN = "https://basis-teller-result.local";

function connectPageHtml(cfg: TellerConfig): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Connect your bank — Basis</title></head>
  <body style="font-family: system-ui; display: grid; place-items: center; height: 95vh; margin: 0;">
    <p>Opening Teller Connect…</p>
    <script src="https://cdn.teller.io/connect/connect.js"></script>
    <script>
      var done = function (path) { window.location.replace(${JSON.stringify(RESULT_ORIGIN)} + path); };
      try {
        var connect = TellerConnect.setup({
          applicationId: ${JSON.stringify(cfg.applicationId)},
          environment: ${JSON.stringify(cfg.env)},
          products: ["balance", "transactions"],
          onSuccess: function (enrollment) {
            done("/success?access_token=" + encodeURIComponent(enrollment.accessToken));
          },
          onExit: function () { done("/cancel"); },
          onFailure: function (f) { done("/error?message=" + encodeURIComponent((f && f.message) || "Connect failed")); },
        });
        connect.open();
      } catch (e) { done("/error?message=" + encodeURIComponent(String(e))); }
    </script>
  </body>
</html>`;
}

/**
 * Open Teller Connect in a dedicated modal window and resolve with the
 * enrollment access token (or cancellation/error). Own session partition so
 * the app's strict CSP never touches it.
 */
export function openConnectWindow(cfg: TellerConfig, parent: BrowserWindow | null): Promise<ConnectResult> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 720,
      parent: parent ?? undefined,
      modal: Boolean(parent),
      autoHideMenuBar: true,
      title: "Connect your bank",
      webPreferences: { partition: "teller-connect" },
    });
    let settled = false;
    const finish = (result: ConnectResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
      if (!win.isDestroyed()) win.close();
    };

    const handleUrl = (url: string) => {
      if (!url.startsWith(RESULT_ORIGIN)) return false;
      const parsed = new URL(url);
      if (parsed.pathname === "/success") {
        const accessToken = parsed.searchParams.get("access_token") ?? "";
        finish(accessToken ? { ok: true, accessToken } : { ok: false, error: "no access token returned" });
      } else if (parsed.pathname === "/cancel") {
        finish({ ok: false, cancelled: true });
      } else {
        finish({ ok: false, error: parsed.searchParams.get("message") ?? "Connect failed" });
      }
      return true;
    };

    win.webContents.on("will-navigate", (event, url) => {
      if (handleUrl(url)) event.preventDefault();
    });
    win.webContents.setWindowOpenHandler((details) => {
      if (handleUrl(details.url)) return { action: "deny" };
      return details.url.startsWith("https://") ? { action: "allow" } : { action: "deny" };
    });
    win.on("closed", () => finish({ ok: false, cancelled: true }));

    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(connectPageHtml(cfg))}`);
  });
}
