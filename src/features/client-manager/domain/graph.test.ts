import { describe, expect, it } from "vitest";
import {
  applyRepairs,
  automaticRepairs,
  type DraftGraph,
  type Extraction,
  emptyGraph,
  mergeExtraction,
  quoteSupported,
  ROOT_KEY,
  validateGraph,
} from "./graph";

const NOTE =
  "Maria Santos, 58, is married to Paolo. She sold her logistics firm Santos Freight in 2024 for $42M. She prefers WhatsApp over email and hates surprises.";

function extraction(partial: Partial<Extraction>): Extraction {
  return { entities: [], relations: [], ...partial };
}

const entity = (
  key: string,
  label: string,
  category: string,
  quote: string,
  extra: Partial<Extraction["entities"][number]> = {},
): Extraction["entities"][number] => ({
  key,
  label,
  type: key.split(":")[0] ?? "fact",
  category,
  summary: "",
  attributes: [],
  quote,
  confidence: 0.9,
  ...extra,
});

describe("mergeExtraction", () => {
  it("adds Nodes and Edges, merging the same entity across Sources", () => {
    const first = mergeExtraction(
      emptyGraph("Maria Santos"),
      extraction({
        entities: [
          entity("person:paolo", "Paolo", "network.family", "married to Paolo"),
        ],
        relations: [
          {
            from: "client",
            to: "person:paolo",
            relation: "MARRIED_TO",
            label: "is married to",
            quote: "married to Paolo",
            confidence: 0.95,
          },
        ],
      }),
      "s1",
    );
    expect(first.added).toEqual(["person:paolo"]);
    expect(first.addedEdges).toEqual(["client|MARRIED_TO|person:paolo"]);

    const second = mergeExtraction(
      first.graph,
      extraction({
        entities: [
          entity("Person: paolo", "Paolo", "network.family", "Paolo", {
            attributes: [{ name: "Age", value: "60" }],
          }),
        ],
        relations: [
          {
            from: "client",
            to: "person:paolo",
            relation: "married to",
            label: "is married to",
            quote: "husband Paolo",
            confidence: 0.8,
          },
        ],
      }),
      "s2",
    );
    expect(second.added).toEqual([]);
    expect(second.updated).toEqual(["person:paolo"]);
    expect(second.graph.edges).toHaveLength(1);
    expect(second.graph.edges[0]?.evidence).toHaveLength(2);
    const paolo = second.graph.nodes.find(
      (node) => node.key === "person:paolo",
    );
    expect(paolo?.attributes.age).toBe("60");
    expect(paolo?.evidence.map((item) => item.sourceId)).toEqual(["s1", "s2"]);
  });

  it("records attribute values two Sources disagree on", () => {
    const one = mergeExtraction(
      emptyGraph("Maria"),
      extraction({
        entities: [
          entity("client", "Maria", "profile.personal", "58", {
            attributes: [{ name: "age", value: "58" }],
          }),
        ],
      }),
      "s1",
    );
    const two = mergeExtraction(
      one.graph,
      extraction({
        entities: [
          entity("client", "Someone else", "wealth.accounts", "59", {
            attributes: [{ name: "age", value: "59" }],
          }),
        ],
      }),
      "s2",
    );
    const root = two.graph.nodes.find((node) => node.key === ROOT_KEY);
    expect(root?.label).toBe("Maria");
    expect(root?.category).toBe("profile.personal");
    expect(root?.conflicts).toEqual([
      { attribute: "age", values: ["58", "59"] },
    ]);
  });

  it("catches a conflict even when two Sources name the attribute differently", () => {
    const one = mergeExtraction(
      emptyGraph("Rafael"),
      extraction({
        entities: [
          entity(
            "liability:mortgage",
            "Mortgage",
            "wealth.liabilities",
            "4.1%",
            {
              attributes: [{ name: "Rate", value: "4.1%" }],
            },
          ),
        ],
      }),
      "note",
    );
    const two = mergeExtraction(
      one.graph,
      extraction({
        entities: [
          entity(
            "liability:mortgage",
            "Mortgage",
            "wealth.liabilities",
            "4.15%",
            {
              attributes: [
                { name: "interest_rate", value: "4.15% fixed until 2028" },
              ],
            },
          ),
        ],
      }),
      "statement",
    );
    const mortgage = two.graph.nodes.find(
      (node) => node.key === "liability:mortgage",
    );
    expect(Object.keys(mortgage?.attributes ?? {})).toEqual(["interest_rate"]);
    expect(mortgage?.conflicts).toEqual([
      {
        attribute: "interest_rate",
        values: ["4.1%", "4.15% fixed until 2028"],
      },
    ]);
  });

  it("merges a new Key with the same type and label into the existing Node", () => {
    const one = mergeExtraction(
      emptyGraph("Maria"),
      extraction({
        entities: [
          entity(
            "organization:santos-freight",
            "Santos Freight",
            "career.business",
            "Santos Freight",
          ),
        ],
      }),
      "s1",
    );
    const two = mergeExtraction(
      one.graph,
      extraction({
        entities: [
          entity(
            "organization:santos-freight-inc",
            "Santos Freight",
            "career.business",
            "Santos Freight",
          ),
        ],
        relations: [
          {
            from: "client",
            to: "organization:santos-freight-inc",
            relation: "FOUNDED",
            label: "founded",
            quote: "her logistics firm Santos Freight",
            confidence: 0.9,
          },
        ],
      }),
      "s2",
    );
    expect(two.graph.nodes).toHaveLength(2);
    expect(two.graph.edges[0]?.to).toBe("organization:santos-freight");
  });
});

describe("validation", () => {
  const sources = [{ id: "s1", text: NOTE }];

  it("accepts quotes that are in the Source, even re-punctuated", () => {
    expect(
      quoteSupported(
        "prefers WhatsApp over email",
        sources[0] ?? { id: "s1", text: NOTE },
      ),
    ).toBe(true);
    expect(
      quoteSupported(
        "sold her logistics firm, Santos Freight",
        sources[0] ?? { id: "s1", text: NOTE },
      ),
    ).toBe(true);
    expect(
      quoteSupported(
        "owns a vineyard in Napa",
        sources[0] ?? { id: "s1", text: NOTE },
      ),
    ).toBe(false);
    expect(quoteSupported("anything", { id: "img", text: null })).toBe(true);
  });

  it("finds orphans, dangling Edges, unsupported facts and conflicts", () => {
    const graph: DraftGraph = {
      nodes: [
        ...emptyGraph("Maria").nodes,
        {
          key: "asset:vineyard",
          label: "Napa vineyard",
          type: "asset",
          category: "wealth.property",
          summary: "",
          attributes: {},
          confidence: 0.9,
          evidence: [{ sourceId: "s1", quote: "owns a vineyard in Napa" }],
          conflicts: [{ attribute: "value", values: ["1M", "2M"] }],
        },
      ],
      edges: [
        {
          from: ROOT_KEY,
          to: "person:ghost",
          relation: "KNOWS",
          label: "knows",
          confidence: 0.5,
          evidence: [],
        },
      ],
    };
    const kinds = validateGraph(graph, sources).map((issue) => issue.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "dangling_edge",
        "orphan",
        "unsupported",
        "conflict",
      ]),
    );
  });

  it("fixes orphans and dangling Edges on its own", () => {
    const merged = mergeExtraction(
      emptyGraph("Maria"),
      extraction({
        entities: [
          entity(
            "preference:whatsapp",
            "Prefers WhatsApp",
            "persona.communication",
            "prefers WhatsApp over email",
          ),
        ],
        relations: [
          {
            from: "client",
            to: "person:nobody",
            relation: "KNOWS",
            label: "knows",
            quote: "",
            confidence: 0.4,
          },
        ],
      }),
      "s1",
    ).graph;
    const issues = validateGraph(merged, sources);
    const { graph, applied } = applyRepairs(
      merged,
      automaticRepairs(merged, issues),
      "check",
    );
    expect(applied.map((repair) => repair.op).sort()).toEqual([
      "add_edge",
      "remove_edge",
    ]);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        from: ROOT_KEY,
        to: "preference:whatsapp",
        relation: "HAS_TRAIT",
      }),
    ]);
    expect(
      validateGraph(graph, sources).filter((issue) =>
        ["orphan", "dangling_edge"].includes(issue.kind),
      ),
    ).toEqual([]);
  });
});

describe("applyRepairs", () => {
  const base = mergeExtraction(
    emptyGraph("Maria"),
    extraction({
      entities: [
        entity("person:paolo", "Paolo", "network.family", "Paolo"),
        entity(
          "person:paolo-santos",
          "Paolo Santos",
          "network.social",
          "Paolo",
        ),
        entity(
          "organization:santos-freight",
          "Santos Freight",
          "wealth.holdings",
          "Santos Freight",
        ),
      ],
      relations: [
        {
          from: "client",
          to: "person:paolo",
          relation: "MARRIED_TO",
          label: "is married to",
          quote: "",
          confidence: 1,
        },
        {
          from: "client",
          to: "person:paolo-santos",
          relation: "MARRIED_TO",
          label: "is married to",
          quote: "",
          confidence: 1,
        },
        {
          from: "person:paolo-santos",
          to: "organization:santos-freight",
          relation: "ADVISES",
          label: "advises",
          quote: "",
          confidence: 1,
        },
      ],
    }),
    "s1",
  ).graph;

  it("merges duplicates, redirects their Edges and drops the twin Edge", () => {
    const { graph, applied } = applyRepairs(
      base,
      [
        {
          op: "merge_nodes",
          keep: "person:paolo",
          drop: "person:paolo-santos",
          reason: "same husband",
        },
      ],
      "critic",
    );
    expect(applied).toHaveLength(1);
    expect(graph.nodes.map((node) => node.key)).not.toContain(
      "person:paolo-santos",
    );
    expect(graph.edges.map((edge) => `${edge.from}>${edge.to}`).sort()).toEqual(
      ["client>person:paolo", "person:paolo>organization:santos-freight"],
    );
  });

  it("moves, updates, settles conflicts and never removes the Root", () => {
    const { graph, applied, skipped } = applyRepairs(
      base,
      [
        {
          op: "move_node",
          key: "organization:santos-freight",
          category: "career.business",
          reason: "a company she sold",
        },
        {
          op: "move_node",
          key: "person:paolo",
          category: "nowhere.at-all",
          reason: "bad",
        },
        { op: "remove_node", key: "client", reason: "never" },
        {
          op: "update_node",
          key: "person:paolo",
          summary: "Her husband",
          reason: "clearer",
        },
        {
          op: "remove_edge",
          from: "person:paolo-santos",
          to: "organization:santos-freight",
          relation: "advises",
          reason: "unsupported",
        },
        { op: "remove_node", key: "person:missing", reason: "gone" },
      ],
      "critic",
    );
    expect(applied.map((repair) => repair.op)).toEqual([
      "move_node",
      "update_node",
      "remove_edge",
    ]);
    expect(skipped).toHaveLength(3);
    expect(
      graph.nodes.find((node) => node.key === "organization:santos-freight")
        ?.category,
    ).toBe("career.business");
    expect(
      graph.nodes.find((node) => node.key === "person:paolo")?.summary,
    ).toBe("Her husband");
    expect(graph.edges).toHaveLength(2);
  });
});
