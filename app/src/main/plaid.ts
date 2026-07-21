import { BrowserWindow } from "electron";

/**
 * Read-only Plaid Investments client. The user supplies their own Plaid
 * client_id/secret (sandbox is free; Plaid's Trial plan covers 10 live
 * items) — Basis talks to Plaid directly, there is no middleman service.
 * Only /investments/holdings/get is ever called: no transactions, no money
 * movement, nothing write-capable.
 */

export type PlaidEnv = "sandbox" | "production";

export interface PlaidConfig {
  clientId: string;
  secret: string;
  env: PlaidEnv;
}

export interface PlaidSecurity {
  security_id: string;
  ticker_symbol?: string | null;
  name?: string | null;
  type?: string | null;
}

export interface PlaidHolding {
  security_id: string;
  quantity: number;
  cost_basis?: number | null;
  institution_price?: number | null;
}

export interface PlaidHoldingsResponse {
  holdings: PlaidHolding[];
  securities: PlaidSecurity[];
}

async function plaidPost<T>(cfg: PlaidConfig, apiPath: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${cfg.env}.plaid.com${apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId, secret: cfg.secret, ...body }),
  });
  const data = (await res.json()) as T & { error_message?: string; error_code?: string };
  if (!res.ok || data.error_code) {
    throw new Error(data.error_message || data.error_code || `Plaid HTTP ${res.status}`);
  }
  return data;
}

export async function createLinkToken(cfg: PlaidConfig): Promise<string> {
  const data = await plaidPost<{ link_token: string }>(cfg, "/link/token/create", {
    client_name: "Basis",
    language: "en",
    country_codes: ["US", "CA"],
    user: { client_user_id: "basis-local-user" },
    products: ["investments"],
  });
  return data.link_token;
}

export async function exchangePublicToken(cfg: PlaidConfig, publicToken: string): Promise<string> {
  const data = await plaidPost<{ access_token: string }>(cfg, "/item/public_token/exchange", {
    public_token: publicToken,
  });
  return data.access_token;
}

export async function fetchHoldings(cfg: PlaidConfig, accessToken: string): Promise<PlaidHoldingsResponse> {
  return plaidPost<PlaidHoldingsResponse>(cfg, "/investments/holdings/get", { access_token: accessToken });
}

export async function removeItem(cfg: PlaidConfig, accessToken: string): Promise<void> {
  await plaidPost(cfg, "/item/remove", { access_token: accessToken });
}

export interface LinkResult {
  ok: boolean;
  publicToken?: string;
  cancelled?: boolean;
  error?: string;
}

// The page signals its result by navigating to this fake origin; main
// intercepts the navigation, so no extra preload/IPC surface is needed.
const RESULT_ORIGIN = "https://basis-plaid-result.local";

function linkPageHtml(linkToken: string): string {
  // Runs in an isolated session partition (our strict app CSP does not apply
  // there), loading Plaid Link from its official CDN.
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Connect your broker — Basis</title></head>
  <body style="font-family: system-ui; display: grid; place-items: center; height: 95vh; margin: 0;">
    <p>Opening Plaid Link…</p>
    <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
    <script>
      var done = function (path) { window.location.replace(${JSON.stringify(RESULT_ORIGIN)} + path); };
      try {
        Plaid.create({
          token: ${JSON.stringify(linkToken)},
          onSuccess: function (publicToken) { done("/success?public_token=" + encodeURIComponent(publicToken)); },
          onExit: function (err) { done(err ? "/error?message=" + encodeURIComponent(err.display_message || err.error_code || "exit") : "/cancel"); },
        }).open();
      } catch (e) { done("/error?message=" + encodeURIComponent(String(e))); }
    </script>
  </body>
</html>`;
}

/**
 * Open Plaid Link in a dedicated modal window and resolve with the
 * public_token (or cancellation/error). The window uses its own session
 * partition so the app's strict CSP and watchers never touch it.
 */
export function openLinkWindow(linkToken: string, parent: BrowserWindow | null): Promise<LinkResult> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 680,
      parent: parent ?? undefined,
      modal: Boolean(parent),
      autoHideMenuBar: true,
      title: "Connect your broker",
      webPreferences: { partition: "plaid-link" },
    });
    let settled = false;
    const finish = (result: LinkResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
      if (!win.isDestroyed()) win.close();
    };

    const handleUrl = (url: string) => {
      if (!url.startsWith(RESULT_ORIGIN)) return false;
      const parsed = new URL(url);
      if (parsed.pathname === "/success") {
        const publicToken = parsed.searchParams.get("public_token") ?? "";
        finish(publicToken ? { ok: true, publicToken } : { ok: false, error: "no public_token returned" });
      } else if (parsed.pathname === "/cancel") {
        finish({ ok: false, cancelled: true });
      } else {
        finish({ ok: false, error: parsed.searchParams.get("message") ?? "Link failed" });
      }
      return true;
    };

    win.webContents.on("will-navigate", (event, url) => {
      if (handleUrl(url)) event.preventDefault();
    });
    // Plaid Link may open OAuth institution pages in a popup; allow only real
    // https pages there, never our fake result origin.
    win.webContents.setWindowOpenHandler((details) => {
      if (handleUrl(details.url)) return { action: "deny" };
      return details.url.startsWith("https://") ? { action: "allow" } : { action: "deny" };
    });
    win.on("closed", () => finish({ ok: false, cancelled: true }));

    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(linkPageHtml(linkToken))}`);
  });
}
