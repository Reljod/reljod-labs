/** The shapes the Canvas Catalog of Meridia is described in. */
export type ColumnType =
  | "integer"
  | "double"
  | "varchar"
  | "date"
  | "timestamp"
  | "boolean";

export type CatalogColumn = {
  name: string;
  type: ColumnType;
  description: string;
  unit?: string;
  restrictedByDefault?: boolean;
};

export type CatalogGroup =
  | "energy"
  | "weather"
  | "air"
  | "transport"
  | "harbour"
  | "budget"
  | "survey"
  | "banking"
  | "reference";

export type CatalogTable = {
  name: string;
  title: string;
  description: string;
  group: CatalogGroup;
  grain: string;
  rows: number;
  columns: CatalogColumn[];
};

export type Cell = string | number | boolean | null;
