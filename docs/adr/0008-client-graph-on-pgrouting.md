# The Client graph lives in Postgres tables and is walked with pgRouting

Client Manager keeps each client's knowledge graph in Supabase Postgres as two plain tables, `client_manager.nodes` and `client_manager.edges`, with integer ids. GraphRAG questions are answered by walking them with the **pgRouting** extension: `pgr_drivingDistance` returns the k-hop neighbourhood of some seed Nodes with the Edge each was reached by, and `pgr_dijkstra` finds the best-supported path between two Nodes (Edges read with more confidence cost less). **pgvector** (`vector(768)`, HNSW, cosine) plus a `tsvector` column picks the seeds, fused by reciprocal rank in `search_nodes`. The Navigator, a tool-calling model, chooses which of these to run, and every call streams to the browser with the SQL it ran, so the graph view can replay the walk.

We chose this over Apache AGE (openCypher in Postgres), the usual "graph database in Postgres": Supabase's hosted Postgres does not offer AGE, while pgRouting and pgvector are both on its extension list. A recursive CTE would also walk the graph, but pgRouting gives depth, predecessor Edge and weighted shortest paths in one call, which is exactly what the traversal animation needs. A separate graph database was ruled out to keep one store for the demo.

The app talks to these tables over a direct Postgres connection (`CLIENT_MANAGER_DATABASE_URL`, the transaction pooler on Vercel, prepared statements off) rather than through the Data API: graph functions take arrays and vectors and run in one transaction with the commit, which PostgREST makes awkward.

## Consequences

- Almost every Node links to the client, so a naive two-hop walk returns the whole graph. `expand_nodes` makes the client a dead end: each Edge into it gets its own stand-in vertex, so the walk can reach the client but not pass through it unless the client is a seed.
- Node ids are identity columns because pgRouting addresses vertices by integer. The app, the model and the view address Nodes by Key (`type:slug`) instead, so ids never leak into prompts.
- The `client_manager` schema does not need to be exposed in the Data API; RLS is on with no policies, and the anon and authenticated roles are revoked.
- Retrieval quality depends on the Category tree and the extractor's Keys as much as on the database: the Navigator sees Category counts up front and can browse a whole Branch when search finds nothing.
