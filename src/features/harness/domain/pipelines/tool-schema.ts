import { z } from "zod";
import type { PipelineInputField, PipelineSpec } from "../pipeline";

/*
 * A Pipeline's input as the input schema of its MCP tool. The server checks
 * the input again with `parseRunInput`, which holds the limits and says what
 * is wrong in words; this schema tells the model the shape to send.
 */

function fieldSchema(field: PipelineInputField): z.ZodType {
  let schema: z.ZodType;
  switch (field.type) {
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "date":
      schema = z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, `${field.name} is a date, YYYY-MM-DD`);
      break;
    case "month":
      schema = z
        .string()
        .regex(/^\d{4}-\d{2}(-01)?$/, `${field.name} is a month, YYYY-MM`);
      break;
    case "id":
      schema = z.string().min(1).max(80);
      break;
    default:
      schema =
        field.options && field.options.length > 0
          ? z.enum(field.options as [string, ...string[]])
          : z.string().max(2_000);
  }
  if (field.multiple) {
    // A list of values (several Source ids): an array, never a comma string.
    schema = z
      .array(schema)
      .min(field.required ? 1 : 0)
      .max(20);
  }
  schema = schema.describe(field.description);
  return field.required ? schema : schema.optional();
}

/** A Pipeline's input as a tool's input schema. */
export function pipelineInputSchema(spec: Pick<PipelineSpec, "inputSchema">) {
  return z.object(
    Object.fromEntries(
      spec.inputSchema.map((field) => [field.name, fieldSchema(field)]),
    ),
  );
}
