import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// A default window.api stub so renderer components/stores don't blow up on
// window.api?.* calls. Functions are memoized per name so tests can assert on
// stable references (e.g. expect(window.api.savePortfolio).toHaveBeenCalled()).
const ARRAY_RETURNING = new Set(["listBriefs"]);
const SUBSCRIPTIONS = new Set([
  "onProgress",
  "onPhase",
  "onDataChanged",
  "onChatDelta",
  "onChatDone",
  "onChatError",
]);

function makeFn(prop: string) {
  if (SUBSCRIPTIONS.has(prop)) return vi.fn(() => () => {});
  if (prop === "llmInfo")
    return vi.fn(async () => ({
      provider: "openai",
      model: "gpt-5.5",
      configured: false,
      modelLocked: false,
      keyLocked: false,
    }));
  if (prop === "loadData") return vi.fn(async () => ({ ok: false, error: "not stubbed" }));
  if (ARRAY_RETURNING.has(prop)) return vi.fn(async () => []);
  if (prop.startsWith("save") || prop.startsWith("start") || prop.startsWith("watch"))
    return vi.fn(async () => ({ ok: true }));
  return vi.fn(async () => null);
}

const cache = new Map<string, unknown>();
const apiStub = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (!cache.has(prop)) cache.set(prop, makeFn(prop));
      return cache.get(prop);
    },
  },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window.api = apiStub;
