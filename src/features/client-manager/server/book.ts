import { InvalidError, NotFoundError } from "@/platform/errors";
import { handleOf } from "../domain/citations";
import type { Persona } from "../domain/events";
import type { CatalogRow } from "./repository";

/** One client a token or a chat can reach, as the Desk and the MCP tools see it. */
export type BookClient = {
  id: string;
  name: string;
  isSample: boolean;
  owner: string | null;
  status: CatalogRow["status"];
  persona: Persona | null;
  nodes: number;
  edges: number;
};

/** The clients a token reaches: every visible one, or the one it is scoped to. */
export type Book = { clients: BookClient[]; visitor: string };

/** The Owner's Catalog as a Book, narrowed to one client when the token is. */
export function bookOf(
  rows: CatalogRow[],
  visitor: string,
  only?: string | null,
): Book {
  return {
    visitor,
    clients: rows
      .filter((row) => !only || row.id === only)
      .map((row) => ({
        id: row.id,
        name: row.name,
        isSample: row.is_sample,
        owner: row.owner,
        status: row.status,
        persona: row.persona,
        nodes: row.node_count,
        edges: row.edge_count,
      })),
  };
}

/** A client by id, Handle or name. With one client in the book, it is the default. */
export function findClient(book: Book, ref?: string | null): BookClient {
  const wanted = (ref ?? "").trim().toLowerCase();
  if (!wanted) {
    if (book.clients.length === 1 && book.clients[0]) return book.clients[0];
    throw new InvalidError(
      "Name the client: an id, a handle or a name from list_clients.",
    );
  }
  const exact =
    book.clients.find((client) => client.id === wanted) ??
    book.clients.find((client) => handleOf(client.id) === wanted) ??
    book.clients.find((client) => client.name.toLowerCase() === wanted);
  if (exact) return exact;
  const partial = book.clients.filter((client) =>
    client.name.toLowerCase().includes(wanted),
  );
  if (partial.length === 1 && partial[0]) return partial[0];
  if (partial.length > 1)
    throw new InvalidError(
      `"${ref}" matches ${partial.map((client) => client.name).join(", ")}. Be more specific.`,
    );
  throw new NotFoundError(`No client "${ref}" here. Call list_clients.`);
}
