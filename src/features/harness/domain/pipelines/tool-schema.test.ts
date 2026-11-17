import { describe, expect, it } from "vitest";
import { z } from "zod";
import { sandboxNote } from "../sandbox";
import { PIPELINES } from "./index";
import { pipelineInputSchema } from "./tool-schema";

const spec = (id: string) => {
  const found = PIPELINES.find((pipeline) => pipeline.id === id);
  if (!found) throw new Error(id);
  return found;
};

const ID = "123e4567-e89b-42d3-a456-426614174000";

describe("pipelineInputSchema", () => {
  it("gives a `multiple` field (sourceIds) as an array of strings", () => {
    const schema = pipelineInputSchema(spec("member_request"));
    const json = z.toJSONSchema(schema) as {
      properties: Record<string, { type?: string; items?: { type?: string } }>;
      required?: string[];
    };
    expect(json.properties.sourceIds).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
    expect(json.required).toContain("sourceIds");
    expect(schema.safeParse({ sourceIds: [ID] }).success).toBe(true);
    expect(schema.safeParse({ sourceIds: ID }).success).toBe(false);
    expect(schema.safeParse({ sourceIds: [] }).success).toBe(false);
  });

  it("keeps single fields single", () => {
    const schema = pipelineInputSchema(spec("contribution_processing"));
    expect(
      schema.safeParse({ sourceId: ID, overrideExceptions: true }).success,
    ).toBe(true);
    expect(schema.safeParse({ sourceId: [ID] }).success).toBe(false);
  });
});

describe("sandboxNote", () => {
  it("tells the Agent when earlier files are gone", () => {
    expect(sandboxNote({})).toBe("");
    expect(sandboxNote({ sandboxCreated: true })).toContain("gone");
    expect(sandboxNote({ sandboxReset: true })).toContain("reset");
  });
});

describe("the Pipeline Skills", () => {
  it("name every input field of their Pipeline's tool", async () => {
    const { SKILL_DEFAULT_LIST } = await import("../skills/defaults");
    for (const pipeline of PIPELINES) {
      const skill = SKILL_DEFAULT_LIST.find(
        (entry) => entry.kind === "skill" && entry.pipelineId === pipeline.id,
      );
      expect(skill, pipeline.id).toBeDefined();
      for (const field of pipeline.inputSchema) {
        expect(skill?.body, `${pipeline.id}.${field.name}`).toContain(
          `\`${field.name}\``,
        );
      }
    }
  });
});
