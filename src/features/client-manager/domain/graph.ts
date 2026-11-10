import {
  branchOf,
  type CategoryId,
  isCategory,
  nearestCategory,
} from "./categories";

/**
 * The Draft graph: what a Build works on before it commits to Postgres.
 * Nodes are addressed by Key (`type:slug`), never by database id, so the
 * model, the Critic and the Repairs all speak the same language. The client
 * is always the Root, Key `client`.
 */

export const ROOT_KEY = "client";

export const NODE_TYPES = [
  "person",
  "organization",
  "account",
  "asset",
  "liability",
  "policy",
  "goal",
  "trait",
  "preference",
  "interest",
  "event",
  "document",
  "place",
  "concern",
  "fact",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export type Evidence = {
  sourceId: string;
  /** Words copied from the Source; empty when the Source is an image. */
  quote: string;
};

export type DraftNode = {
  key: string;
  label: string;
  type: NodeType;
  category: CategoryId;
  summary: string;
  attributes: Record<string, string>;
  confidence: number;
  evidence: Evidence[];
  /** Attribute values two Sources disagree on, until a Repair settles them. */
  conflicts?: { attribute: string; values: string[] }[];
  /** Set once the Node is in Postgres. */
  id?: number;
};

export type DraftEdge = {
  from: string;
  to: string;
  /** UPPER_SNAKE verb, such as `MARRIED_TO` or `HOLDS`. */
  relation: string;
  /** The same relation in plain words, read from → to: "is married to". */
  label: string;
  confidence: number;
  evidence: Evidence[];
  id?: number;
};

export type DraftGraph = { nodes: DraftNode[]; edges: DraftEdge[] };

export function edgeKey(edge: Pick<DraftEdge, "from" | "to" | "relation">) {
  return `${edge.from}|${edge.relation}|${edge.to}`;
}

export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** `Person: Maria Santos` and `person:maria_santos` are the same Key. */
export function normalizeKey(raw: string, type?: string) {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === ROOT_KEY) return ROOT_KEY;
  const [head, ...rest] = trimmed.split(":");
  if (rest.length > 0 && head) {
    return `${slugify(head) || "fact"}:${slugify(rest.join(":")) || "item"}`;
  }
  return `${slugify(type ?? "fact") || "fact"}:${slugify(trimmed) || "item"}`;
}

export function normalizeRelation(value: string) {
  const relation = value
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 40);
  return relation || "RELATED_TO";
}

export function asNodeType(value: string): NodeType {
  const lower = value.toLowerCase().trim();
  return (NODE_TYPES as readonly string[]).includes(lower)
    ? (lower as NodeType)
    : "fact";
}

export function rootNode(name: string): DraftNode {
  return {
    key: ROOT_KEY,
    label: name,
    type: "person",
    category: "profile.personal",
    summary: "",
    attributes: {},
    confidence: 1,
    evidence: [],
  };
}

export function emptyGraph(name: string): DraftGraph {
  return { nodes: [rootNode(name)], edges: [] };
}

/** What the model hands back for one Source, before it joins the Draft graph. */
export type Extraction = {
  entities: {
    key: string;
    label: string;
    type: string;
    category: string;
    summary: string;
    attributes: { name: string; value: string }[];
    quote: string;
    confidence: number;
  }[];
  relations: {
    from: string;
    to: string;
    relation: string;
    label: string;
    quote: string;
    confidence: number;
  }[];
};

const clamp01 = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;

function addEvidence(list: Evidence[], evidence: Evidence) {
  if (
    !list.some(
      (item) =>
        item.sourceId === evidence.sourceId && item.quote === evidence.quote,
    )
  ) {
    list.push(evidence);
  }
}

/**
 * Names Sources use for the same fact, folded to one, so two Sources that
 * disagree are caught as a conflict instead of kept side by side.
 */
const ATTRIBUTE_ALIASES: Record<string, string> = {
  rate: "interest_rate",
  fixed_rate: "interest_rate",
  apr: "interest_rate",
  dob: "date_of_birth",
  birthday: "date_of_birth",
  birth_date: "date_of_birth",
  occupation: "role",
  job_title: "role",
  email_address: "email",
  phone_number: "phone",
  telephone: "phone",
  mobile: "phone",
  stake: "ownership",
  stake_percent: "ownership",
  ownership_percent: "ownership",
  shareholding: "ownership",
};

export function attributeName(name: string) {
  const plain = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return ATTRIBUTE_ALIASES[plain] ?? plain;
}

function mergeAttributes(
  into: DraftNode,
  attributes: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(attributes)) {
    const current = into.attributes[name];
    if (current === undefined || current === "") {
      into.attributes[name] = value;
      continue;
    }
    if (sameValue(current, value)) continue;
    if (!into.conflicts) into.conflicts = [];
    const conflicts = into.conflicts;
    const existing = conflicts.find((item) => item.attribute === name);
    if (existing) {
      if (!existing.values.some((item) => sameValue(item, value))) {
        existing.values.push(value);
      }
    } else {
      conflicts.push({ attribute: name, values: [current, value] });
    }
  }
}

function sameValue(a: string, b: string) {
  const clean = (value: string) => value.toLowerCase().replace(/[\s,$€£]/g, "");
  return clean(a) === clean(b);
}

/** Folds one Node into another: evidence, attributes, the better summary. */
function absorb(into: DraftNode, from: DraftNode) {
  for (const evidence of from.evidence) addEvidence(into.evidence, evidence);
  mergeAttributes(into, from.attributes);
  for (const conflict of from.conflicts ?? []) {
    for (const value of conflict.values) {
      mergeAttributes(into, { [conflict.attribute]: value });
    }
  }
  if (from.summary.length > into.summary.length) into.summary = from.summary;
  into.confidence = Math.max(into.confidence, from.confidence);
}

function dedupeEdges(edges: DraftEdge[]): DraftEdge[] {
  const byKey = new Map<string, DraftEdge>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    const key = edgeKey(edge);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, edge);
      continue;
    }
    for (const evidence of edge.evidence) {
      addEvidence(existing.evidence, evidence);
    }
    existing.confidence = Math.max(existing.confidence, edge.confidence);
    existing.id ??= edge.id;
  }
  return [...byKey.values()];
}

function labelKey(node: Pick<DraftNode, "type" | "label">) {
  return `${node.type}:${slugify(node.label)}`;
}

/** One extracted entity as a Draft Node: Key, type and Category normalised. */
export function entityToNode(
  entity: Extraction["entities"][number],
  sourceId: string,
): DraftNode {
  const type = asNodeType(entity.type);
  const key = normalizeKey(entity.key || entity.label, type);
  const attributes = Object.fromEntries(
    (entity.attributes ?? [])
      .map(
        ({ name, value }) =>
          [attributeName(name ?? ""), String(value ?? "").trim()] as const,
      )
      .filter(([name, value]) => name && value),
  );
  return {
    key,
    label: (entity.label ?? "").trim() || key,
    type: key === ROOT_KEY ? "person" : type,
    category:
      key === ROOT_KEY
        ? "profile.personal"
        : nearestCategory(entity.category ?? ""),
    summary: (entity.summary ?? "").trim(),
    attributes,
    confidence: clamp01(entity.confidence),
    evidence: [{ sourceId, quote: (entity.quote ?? "").trim() }],
  };
}

export function relationToEdge(
  relation: Extraction["relations"][number],
  sourceId: string,
): DraftEdge {
  return {
    from: normalizeKey(relation.from ?? ""),
    to: normalizeKey(relation.to ?? ""),
    relation: normalizeRelation(relation.relation ?? ""),
    label:
      (relation.label ?? "").trim() || (relation.relation ?? "").toLowerCase(),
    confidence: clamp01(relation.confidence),
    evidence: [{ sourceId, quote: (relation.quote ?? "").trim() }],
  };
}

export type MergeResult = {
  graph: DraftGraph;
  /** Keys that are new to the graph, in the order they arrived. */
  added: string[];
  /** Keys that already existed and gained evidence or attributes. */
  updated: string[];
  addedEdges: string[];
};

/**
 * Joins one Source's Extraction to the Draft graph. Keys are normalised, so
 * the same person named in two Sources becomes one Node; a Node with the same
 * type and label as an existing one merges into it too. Unknown Categories
 * snap to the nearest real one.
 */
export function mergeExtraction(
  graph: DraftGraph,
  extraction: Extraction,
  sourceId: string,
): MergeResult {
  const nodes = graph.nodes.map((node) => structuredClone(node));
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const byLabel = new Map(nodes.map((node) => [labelKey(node), node.key]));
  const alias = new Map<string, string>();
  const added: string[] = [];
  const updated = new Set<string>();

  for (const entity of extraction.entities) {
    const incoming = entityToNode(entity, sourceId);
    const sameLabel = byLabel.get(labelKey(incoming));
    if (!byKey.has(incoming.key) && sameLabel) {
      alias.set(incoming.key, sameLabel);
      incoming.key = sameLabel;
    }
    const key = incoming.key;
    const existing = byKey.get(key);
    if (existing) {
      if (key === ROOT_KEY) {
        // The client's name comes from the Intake form, never a Source.
        incoming.label = existing.label;
      }
      absorb(existing, incoming);
      if (!added.includes(key)) updated.add(key);
    } else {
      nodes.push(incoming);
      byKey.set(key, incoming);
      byLabel.set(labelKey(incoming), key);
      added.push(key);
    }
  }

  const resolve = (raw: string) => {
    const key = normalizeKey(raw);
    return alias.get(key) ?? key;
  };
  const before = new Set(graph.edges.map(edgeKey));
  const fresh: DraftEdge[] = extraction.relations.map((relation) => {
    const edge = relationToEdge(relation, sourceId);
    return { ...edge, from: resolve(edge.from), to: resolve(edge.to) };
  });
  const edges = dedupeEdges([
    ...graph.edges.map((edge) => structuredClone(edge)),
    ...fresh,
  ]);
  return {
    graph: { nodes, edges },
    added,
    updated: [...updated],
    addedEdges: edges.map(edgeKey).filter((key) => !before.has(key)),
  };
}

// Validation ------------------------------------------------------------------

export type IssueKind =
  | "dangling_edge"
  | "orphan"
  | "unsupported"
  | "conflict"
  | "low_confidence";

export type Issue = {
  kind: IssueKind;
  /** The Node Keys or Edge Key the Issue is about. */
  target: string;
  detail: string;
};

export type SourceText = {
  id: string;
  /** null for images: the model read the pixels, so there is no text to match. */
  text: string | null;
};

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "has",
  "have",
  "was",
  "are",
  "his",
  "her",
  "their",
]);

function tokens(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP.has(token));
}

/**
 * Whether a quote is really in the Source. Exact after normalising space and
 * case, or at least four in five of its words present, so a quote the model
 * trimmed or re-punctuated still counts.
 */
export function quoteSupported(quote: string, source: SourceText) {
  if (source.text === null) return true;
  const squash = (value: string) =>
    value.toLowerCase().replace(/\s+/g, " ").trim();
  const needle = squash(quote);
  if (!needle) return false;
  if (squash(source.text).includes(needle)) return true;
  const wanted = tokens(quote);
  if (wanted.length === 0) return false;
  const have = new Set(tokens(source.text));
  const found = wanted.filter((token) => have.has(token)).length;
  return found / wanted.length >= 0.8;
}

export function hasSupport(evidence: Evidence[], sources: SourceText[]) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return evidence.some((item) => {
    const source = byId.get(item.sourceId);
    // Evidence from an earlier Build was checked when that Build ran.
    if (!source) return true;
    return quoteSupported(item.quote, source);
  });
}

/**
 * The checks code can make on its own, before and after the Critic: every
 * Edge joins two Nodes, every Node is reachable, every fact is quoted from a
 * Source that says it, and no attribute has two values.
 */
export function validateGraph(
  graph: DraftGraph,
  sources: SourceText[],
): Issue[] {
  const issues: Issue[] = [];
  const keys = new Set(graph.nodes.map((node) => node.key));
  const linked = new Set<string>();
  for (const edge of graph.edges) {
    if (!keys.has(edge.from) || !keys.has(edge.to)) {
      issues.push({
        kind: "dangling_edge",
        target: edgeKey(edge),
        detail: `${edge.relation} points at ${keys.has(edge.from) ? edge.to : edge.from}, which is not a Node`,
      });
      continue;
    }
    linked.add(edge.from);
    linked.add(edge.to);
  }
  for (const node of graph.nodes) {
    if (node.key === ROOT_KEY) continue;
    if (!linked.has(node.key)) {
      issues.push({
        kind: "orphan",
        target: node.key,
        detail: `${node.label} is not connected to anything`,
      });
    }
    if (node.evidence.length > 0 && !hasSupport(node.evidence, sources)) {
      issues.push({
        kind: "unsupported",
        target: node.key,
        detail: `No Source says "${node.evidence[0]?.quote.slice(0, 80) ?? ""}"`,
      });
    }
    for (const conflict of node.conflicts ?? []) {
      issues.push({
        kind: "conflict",
        target: node.key,
        detail: `${node.label}: ${conflict.attribute} is ${conflict.values.map((value) => `"${value}"`).join(" or ")}`,
      });
    }
    if (node.confidence < 0.35) {
      issues.push({
        kind: "low_confidence",
        target: node.key,
        detail: `${node.label} was read with ${Math.round(node.confidence * 100)}% confidence`,
      });
    }
  }
  for (const edge of graph.edges) {
    if (!keys.has(edge.from) || !keys.has(edge.to)) continue;
    if (edge.evidence.length > 0 && !hasSupport(edge.evidence, sources)) {
      issues.push({
        kind: "unsupported",
        target: edgeKey(edge),
        detail: `No Source says "${edge.evidence[0]?.quote.slice(0, 80) ?? ""}"`,
      });
    }
  }
  return issues;
}

// Repairs ---------------------------------------------------------------------

export type Repair =
  | { op: "remove_node"; key: string; reason: string }
  | { op: "merge_nodes"; keep: string; drop: string; reason: string }
  | { op: "move_node"; key: string; category: string; reason: string }
  | {
      op: "update_node";
      key: string;
      label?: string;
      summary?: string;
      reason: string;
    }
  | {
      op: "resolve_conflict";
      key: string;
      attribute: string;
      value: string;
      reason: string;
    }
  | {
      op: "add_edge";
      from: string;
      to: string;
      relation: string;
      label: string;
      reason: string;
    }
  | {
      op: "remove_edge";
      from: string;
      to: string;
      relation: string;
      reason: string;
    };

export type AppliedRepair = Repair & {
  /** Who asked for it: code's own checks, or the Critic. */
  by: "check" | "critic";
  /** Node Keys whose place or look changes, for the view to animate. */
  touches: string[];
};

/** The plain verb an Edge from the Root takes when it has to be added for an orphan. */
const ROOT_RELATION: Record<string, { relation: string; label: string }> = {
  profile: { relation: "HAS", label: "has" },
  network: { relation: "KNOWS", label: "knows" },
  career: { relation: "INVOLVED_IN", label: "is involved in" },
  wealth: { relation: "OWNS", label: "owns" },
  goals: { relation: "PLANS", label: "plans" },
  persona: { relation: "HAS_TRAIT", label: "is characterised by" },
  risk: { relation: "EXPOSED_TO", label: "is exposed to" },
  timeline: { relation: "EXPERIENCED", label: "has a life event" },
};

/** Fixes code can make without asking anyone. */
export function automaticRepairs(graph: DraftGraph, issues: Issue[]): Repair[] {
  const byKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const repairs: Repair[] = [];
  for (const issue of issues) {
    if (issue.kind === "dangling_edge") {
      const [from, relation, to] = issue.target.split("|");
      repairs.push({
        op: "remove_edge",
        from: from ?? "",
        to: to ?? "",
        relation: relation ?? "",
        reason: issue.detail,
      });
    }
    if (issue.kind === "orphan") {
      const node = byKey.get(issue.target);
      if (!node) continue;
      const verb =
        ROOT_RELATION[branchOf(node.category)] ?? ROOT_RELATION.profile;
      repairs.push({
        op: "add_edge",
        from: ROOT_KEY,
        to: node.key,
        relation: verb?.relation ?? "HAS",
        label: verb?.label ?? "has",
        reason: `Connected ${node.label} to the client so it can be reached`,
      });
    }
  }
  return repairs;
}

/**
 * Applies Repairs in order. Any Repair that would touch the Root's identity,
 * or name a Node that is no longer there, is skipped rather than guessed at.
 */
export function applyRepairs(
  graph: DraftGraph,
  repairs: Repair[],
  by: AppliedRepair["by"],
): { graph: DraftGraph; applied: AppliedRepair[]; skipped: Repair[] } {
  let nodes = graph.nodes.map((node) => structuredClone(node));
  let edges = graph.edges.map((edge) => structuredClone(edge));
  const applied: AppliedRepair[] = [];
  const skipped: Repair[] = [];
  const find = (key: string) =>
    nodes.find((node) => node.key === normalizeKey(key));

  for (const repair of repairs) {
    switch (repair.op) {
      case "remove_node": {
        const node = find(repair.key);
        if (!node || node.key === ROOT_KEY) {
          skipped.push(repair);
          break;
        }
        nodes = nodes.filter((item) => item !== node);
        edges = edges.filter(
          (edge) => edge.from !== node.key && edge.to !== node.key,
        );
        applied.push({ ...repair, key: node.key, by, touches: [node.key] });
        break;
      }
      case "merge_nodes": {
        const keep = find(repair.keep);
        const drop = find(repair.drop);
        if (!keep || !drop || keep === drop || drop.key === ROOT_KEY) {
          skipped.push(repair);
          break;
        }
        absorb(keep, drop);
        nodes = nodes.filter((item) => item !== drop);
        edges = dedupeEdges(
          edges.map((edge) => ({
            ...edge,
            from: edge.from === drop.key ? keep.key : edge.from,
            to: edge.to === drop.key ? keep.key : edge.to,
          })),
        );
        applied.push({
          ...repair,
          keep: keep.key,
          drop: drop.key,
          by,
          touches: [keep.key, drop.key],
        });
        break;
      }
      case "move_node": {
        const node = find(repair.key);
        if (!node || node.key === ROOT_KEY || !isCategory(repair.category)) {
          skipped.push(repair);
          break;
        }
        if (node.category === repair.category) {
          skipped.push(repair);
          break;
        }
        node.category = repair.category;
        applied.push({ ...repair, key: node.key, by, touches: [node.key] });
        break;
      }
      case "update_node": {
        const node = find(repair.key);
        if (!node) {
          skipped.push(repair);
          break;
        }
        if (repair.label?.trim() && node.key !== ROOT_KEY) {
          node.label = repair.label.trim();
        }
        if (repair.summary?.trim()) node.summary = repair.summary.trim();
        applied.push({ ...repair, key: node.key, by, touches: [node.key] });
        break;
      }
      case "resolve_conflict": {
        const node = find(repair.key);
        const name = attributeName(repair.attribute);
        if (!node || !repair.value.trim()) {
          skipped.push(repair);
          break;
        }
        node.attributes[name] = repair.value.trim();
        node.conflicts = (node.conflicts ?? []).filter(
          (conflict) => conflict.attribute !== name,
        );
        if (node.conflicts.length === 0) delete node.conflicts;
        applied.push({ ...repair, key: node.key, by, touches: [node.key] });
        break;
      }
      case "add_edge": {
        const from = find(repair.from);
        const to = find(repair.to);
        if (!from || !to || from === to) {
          skipped.push(repair);
          break;
        }
        const edge: DraftEdge = {
          from: from.key,
          to: to.key,
          relation: normalizeRelation(repair.relation),
          label: repair.label.trim() || repair.relation.toLowerCase(),
          confidence: by === "check" ? 0.6 : 0.75,
          evidence: [],
        };
        if (edges.some((item) => edgeKey(item) === edgeKey(edge))) {
          skipped.push(repair);
          break;
        }
        edges.push(edge);
        applied.push({
          ...repair,
          from: from.key,
          to: to.key,
          relation: edge.relation,
          by,
          touches: [from.key, to.key],
        });
        break;
      }
      case "remove_edge": {
        const relation = normalizeRelation(repair.relation);
        const before = edges.length;
        const from = normalizeKey(repair.from);
        const to = normalizeKey(repair.to);
        edges = edges.filter(
          (edge) =>
            !(
              edge.from === from &&
              edge.to === to &&
              (edge.relation === relation || !repair.relation)
            ),
        );
        if (edges.length === before) {
          skipped.push(repair);
          break;
        }
        applied.push({ ...repair, by, touches: [from, to] });
        break;
      }
    }
  }
  return { graph: { nodes, edges }, applied, skipped };
}

// Compact text for prompts -------------------------------------------------------

/** One line per Node and Edge: what the Critic and the extractor are shown. */
export function describeGraph(graph: DraftGraph, limit = 400) {
  const nodes = graph.nodes.slice(0, limit).map((node) => {
    const attributes = Object.entries(node.attributes)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    return `N ${node.key} | ${node.label} | ${node.category} | ${node.summary}${attributes ? ` | ${attributes}` : ""}${node.conflicts?.length ? ` | CONFLICT ${node.conflicts.map((item) => `${item.attribute}: ${item.values.join(" vs ")}`).join("; ")}` : ""}`;
  });
  const edges = graph.edges
    .slice(0, limit * 2)
    .map((edge) => `E ${edge.from} -${edge.relation}-> ${edge.to}`);
  return [...nodes, ...edges].join("\n");
}

export function graphStats(graph: DraftGraph) {
  const branches = new Set(graph.nodes.map((node) => branchOf(node.category)));
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    branches: branches.size,
  };
}

/** A Repair in one line, for the Critic's next round and the Build's log. */
export function describeRepair(repair: Repair): string {
  switch (repair.op) {
    case "remove_node":
      return `removed ${repair.key}`;
    case "merge_nodes":
      return `merged ${repair.drop} into ${repair.keep}`;
    case "move_node":
      return `moved ${repair.key} to ${repair.category}`;
    case "update_node":
      return `reworded ${repair.key}`;
    case "resolve_conflict":
      return `set ${repair.key} ${repair.attribute} = ${repair.value}`;
    case "add_edge":
      return `linked ${repair.from} -${repair.relation}-> ${repair.to}`;
    case "remove_edge":
      return `unlinked ${repair.from} -${repair.relation}-> ${repair.to}`;
  }
}
