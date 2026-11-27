import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { NotFoundError } from "@/platform/errors";
import { type CatalogEntry, ownerCatalog } from "../../domain/catalog";
import { SKILLS, type Skill, skillOf } from "../../skills";
import type { Caller, TrailRepository, UploadRepository } from "../ports";
import type { RuleService } from "./rules";

/** A Table's column, and whether the Rules restrict it. */
export type DescribedColumn = CatalogEntry["columns"][number] & {
  restricted: boolean;
};

/**
 * What the Analyst may ask about: the Catalog (the Meridia Tables and the
 * Owner's Uploads) with the Restricted columns the Rules name, and the Skills
 * it may load.
 */
export interface CatalogService {
  tables(owner: Owner): Promise<{
    tables: CatalogEntry[];
    restrictedColumns: string[];
    minGroupSize: number;
  }>;
  /** One Table's columns, marked where Restricted; 404 for no such Table. */
  describe(
    owner: Owner,
    table: string,
  ): Promise<Omit<CatalogEntry, "columns"> & { columns: DescribedColumn[] }>;
  skills(): readonly Skill[];
  /** A Skill's SKILL.md, loaded onto the Trail; 404 for no such Skill. */
  loadSkill(caller: Caller, id: string): Promise<Skill>;
}

export function createCatalogService(ports: {
  uploads: UploadRepository;
  rules: Pick<RuleService, "current">;
  trail: TrailRepository;
}): CatalogService {
  const read = async (owner: Owner) => {
    const [uploads, rulebook] = await Promise.all([
      ports.uploads.ready(owner),
      ports.rules.current(owner),
    ]);
    const restricted = rulebook.rulebook["access.restricted_columns"];
    return {
      catalog: ownerCatalog(uploads),
      restrictedColumns: restricted.params.columns as string[],
      minGroupSize: restricted.params.minGroupSize as number,
    };
  };

  return {
    async tables(owner) {
      const { catalog, restrictedColumns, minGroupSize } = await read(owner);
      return { tables: catalog.tables, restrictedColumns, minGroupSize };
    },

    async describe(owner, name) {
      const { catalog, restrictedColumns } = await read(owner);
      const table = catalog.tables.find(
        (item) => item.name === name.trim().toLowerCase(),
      );
      if (!table)
        throw new NotFoundError(
          `There is no Table "${name}". Call list_tables.`,
        );
      const restricted = new Set(
        restrictedColumns
          .filter((column) => column.startsWith(`${table.name}.`))
          .map((column) => column.split(".")[1]),
      );
      return {
        ...table,
        columns: table.columns.map((column) => ({
          ...column,
          restricted: restricted.has(column.name),
        })),
      };
    },

    skills: () => SKILLS,

    async loadSkill(caller, id) {
      const skill = skillOf(id);
      if (!skill)
        throw new NotFoundError(
          `There is no Skill "${id}". They are: ${SKILLS.map((item) => item.id).join(", ")}.`,
        );
      await ports.trail.record(caller, {
        action: "skill.loaded",
        summary: `Loaded the ${skill.name} Skill`,
        detail: { skill: skill.id },
      });
      return skill;
    },
  };
}
