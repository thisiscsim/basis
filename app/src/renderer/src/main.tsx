import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useApp } from "./store";
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles/ui.css";
import "./styles/workspace.css";
import "./styles.css";

// Global handlers for errors the React error boundary can't see (event
// handlers, async/IPC rejections). Route them to the shared log file and a
// toast so they aren't swallowed by a usually-closed DevTools console.
window.addEventListener("error", (e) => {
  const msg = e.error?.stack || e.message || String(e.error);
  void window.api?.logRenderer("error", `window.onerror: ${msg}`);
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason instanceof Error ? (e.reason.stack ?? e.reason.message) : String(e.reason);
  void window.api?.logRenderer("error", `unhandledrejection: ${reason}`);
  useApp.getState().pushNotice("error", `Something failed: ${reason}`.slice(0, 300));
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
