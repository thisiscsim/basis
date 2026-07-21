// Pure knowledge-graph logic: edge identity, merge/dedupe, and the
// second-order traversal that connects a filer to the user's holdings.
// No fs, no network — unit-tested in graph.test.mjs.

const SUFFIXES =
  /\b(incorporated|corporation|company|holdings|group|inc|corp|co|ltd|llc|plc|sa|ag|nv|se)\b\.?/g;

/** Normalize a company name for identity/matching ("Apple Inc." == "APPLE, INC"). */
export function normalizeCompany(name) {
  return String(name)
    .toLowerCase()
    .replace(/[.,'’&()-]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable identity for an edge: filer + relationship + normalized counterparty. */
export function edgeId(edge) {
  return `${edge.from}|${edge.rel}|${normalizeCompany(edge.to)}`.slice(0, 160);
}

/**
 * Merge new edges into the graph, deduping by edgeId (existing edges win —
 * re-extraction shouldn't churn quotes). Returns { edges, added }.
 */
export function mergeEdges(existing, incoming) {
  const byId = new Map(existing.map((e) => [e.id, e]));
  let added = 0;
  for (const edge of incoming) {
    const id = edgeId(edge);
    if (byId.has(id)) continue;
    byId.set(id, { ...edge, id });
    added++;
  }
  return { edges: [...byId.values()].slice(0, 1000), added };
}

/**
 * Second-order inference: which tickers in `universe` (the user's holdings +
 * watchlist, excluding the filer) are connected to `filer` in the graph?
 *
 * 1 hop:  filer -> U (or U -> filer) directly.
 * 2 hops: filer and U both relate to the same (possibly private)
 *         counterparty name.
 *
 * Returns [{ticker, path}] (max 5), 1-hop matches first. Every path is
 * backed by verified, quoted edges — the traversal itself is deterministic.
 */
export function relatedTickers(edges, filer, universe) {
  const wanted = new Set([...universe].filter((t) => t !== filer));
  if (wanted.size === 0) return [];
  const out = [];
  const seen = new Set();
  const push = (ticker, path) => {
    if (!seen.has(ticker) && out.length < 5) {
      seen.add(ticker);
      out.push({ ticker, path: path.slice(0, 256) });
    }
  };

  // 1 hop, either direction.
  for (const e of edges) {
    if (e.from === filer && e.toTicker && wanted.has(e.toTicker)) {
      push(e.toTicker, `${filer} lists ${e.to} as ${relLabel(e.rel)}`);
    } else if (e.toTicker === filer && wanted.has(e.from)) {
      push(e.from, `${e.from} lists ${e.to} as ${relLabel(e.rel)}`);
    }
  }

  // 2 hops via a shared counterparty name.
  const filerNeighbors = new Map(); // normalized name -> edge
  for (const e of edges) {
    if (e.from === filer) filerNeighbors.set(normalizeCompany(e.to), e);
  }
  for (const e of edges) {
    if (!wanted.has(e.from) || seen.has(e.from)) continue;
    const shared = filerNeighbors.get(normalizeCompany(e.to));
    if (shared) {
      push(e.from, `both ${filer} and ${e.from} relate to ${shared.to}`);
    }
  }
  return out;
}

function relLabel(rel) {
  switch (rel) {
    case "supplier":
      return "a supplier";
    case "customer":
      return "a customer";
    case "partner":
      return "a partner";
    case "competitor":
      return "a competitor";
    case "investor":
      return "an investor";
    case "subsidiary":
      return "a subsidiary";
    default:
      return "related";
  }
}
