-- Client Manager: a wealth manager's clients, each with a Client graph built
-- from their Intake, and GraphRAG conversations over it.
--
-- The graph lives in plain tables (nodes, edges) and is traversed with the
-- pgRouting extension: pgr_drivingDistance for k-hop neighbourhoods and
-- pgr_dijkstra for how two facts connect. pgvector indexes every Node for the
-- first hop of a question. See docs/adr/0008-client-graph-on-pgrouting.md.
--
-- Accessed only from server code over a direct Postgres connection
-- (CLIENT_MANAGER_DATABASE_URL); never from the browser or the Data API.

create extension if not exists vector with schema extensions;
-- pgRouting needs PostGIS; cascade installs it into `extensions` if missing.
create extension if not exists pgrouting with schema extensions cascade;

create schema if not exists client_manager;

-- Clients ---------------------------------------------------------------------

create table client_manager.clients (
  id uuid primary key default gen_random_uuid(),
  -- The browser session that added the client. Samples have none and are
  -- shown to every visitor.
  session_id uuid,
  is_sample boolean not null default false,
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'building'
    check (status in ('building', 'ready', 'failed')),
  -- Inferred by the Persona job: archetype, headline, traits, questions.
  persona jsonb,
  portrait_path text,
  portrait_source text check (portrait_source in ('generated', 'uploaded')),
  -- Salted hash of the visitor's IP, used only for rate limiting.
  visitor_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

create index clients_session_idx on client_manager.clients (session_id, created_at desc);
create index clients_sample_idx on client_manager.clients (created_at) where is_sample;
create index clients_visitor_idx on client_manager.clients (visitor_hash, created_at);
create index clients_expires_idx on client_manager.clients (expires_at) where not is_sample;

-- Builds: one run of the pipeline that turns Sources into graph --------------

create table client_manager.builds (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client_manager.clients (id) on delete cascade,
  workflow_run_id text,
  trigger text not null check (trigger in ('intake', 'addition')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'stopped')),
  -- nodes, edges, repairs, rounds, cost, tokens, duration.
  stats jsonb,
  error text,
  visitor_hash text not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index builds_client_idx on client_manager.builds (client_id, created_at desc);
create index builds_visitor_idx on client_manager.builds (visitor_hash, created_at);

-- Sources: what the Intake (or a later addition) was made of ------------------

create table client_manager.sources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client_manager.clients (id) on delete cascade,
  build_id uuid references client_manager.builds (id) on delete set null,
  kind text not null check (kind in ('note', 'pdf', 'image', 'sheet', 'doc', 'text')),
  name text not null,
  media_type text not null,
  storage_path text,
  byte_size integer not null default 0,
  -- The text the extractor read; null for images, which it reads as pixels.
  text text,
  created_at timestamptz not null default now()
);

create index sources_client_idx on client_manager.sources (client_id);

-- The Client graph --------------------------------------------------------------

create table client_manager.nodes (
  -- pgRouting addresses vertices by integer id.
  id bigint generated always as identity primary key,
  client_id uuid not null references client_manager.clients (id) on delete cascade,
  key text not null,
  label text not null,
  type text not null,
  -- A leaf of the Category tree, `branch.leaf`.
  category text not null check (category ~ '^[a-z]+\.[a-z_]+$'),
  summary text not null default '',
  attributes jsonb not null default '{}',
  confidence real not null default 0.5,
  is_root boolean not null default false,
  embedding extensions.vector(768),
  search tsvector generated always as (
    setweight(to_tsvector('english', label), 'A')
    || setweight(to_tsvector('english', summary), 'B')
    || jsonb_to_tsvector('english', attributes, '["string"]')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, key)
);

create index nodes_client_category_idx on client_manager.nodes (client_id, category);
create index nodes_search_idx on client_manager.nodes using gin (search);
create index nodes_embedding_idx on client_manager.nodes
  using hnsw (embedding extensions.vector_cosine_ops);

create table client_manager.edges (
  id bigint generated always as identity primary key,
  client_id uuid not null references client_manager.clients (id) on delete cascade,
  source_id bigint not null references client_manager.nodes (id) on delete cascade,
  target_id bigint not null references client_manager.nodes (id) on delete cascade,
  relation text not null check (relation ~ '^[A-Z0-9_]+$'),
  label text not null,
  confidence real not null default 0.5,
  created_at timestamptz not null default now(),
  check (source_id <> target_id),
  unique (client_id, source_id, target_id, relation)
);

create index edges_client_idx on client_manager.edges (client_id);
create index edges_source_idx on client_manager.edges (source_id);
create index edges_target_idx on client_manager.edges (target_id);

-- Evidence: the words in a Source that a Node or Edge stands on -----------------

create table client_manager.evidence (
  id bigint generated always as identity primary key,
  client_id uuid not null references client_manager.clients (id) on delete cascade,
  node_id bigint references client_manager.nodes (id) on delete cascade,
  edge_id bigint references client_manager.edges (id) on delete cascade,
  source_id uuid not null references client_manager.sources (id) on delete cascade,
  quote text not null default '',
  check ((node_id is null) <> (edge_id is null))
);

create index evidence_node_idx on client_manager.evidence (node_id);
create index evidence_edge_idx on client_manager.evidence (edge_id);

-- Repairs: what the checks and the Critic changed, per Build round -------------

create table client_manager.repairs (
  id bigint generated always as identity primary key,
  build_id uuid not null references client_manager.builds (id) on delete cascade,
  round integer not null,
  by text not null check (by in ('check', 'critic')),
  op text not null,
  detail jsonb not null,
  created_at timestamptz not null default now()
);

create index repairs_build_idx on client_manager.repairs (build_id);

-- Conversations -----------------------------------------------------------------

create table client_manager.messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client_manager.clients (id) on delete cascade,
  session_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  mode text not null check (mode in ('ask', 'add', 'build')),
  content text not null,
  -- The Traversal the Navigator made, so a reload can replay it.
  traversal jsonb,
  build_id uuid references client_manager.builds (id) on delete set null,
  visitor_hash text not null,
  created_at timestamptz not null default now()
);

create index messages_thread_idx on client_manager.messages (client_id, session_id, created_at);
create index messages_visitor_idx on client_manager.messages (visitor_hash, created_at);

-- Spend: every model call, with the cost the gateway reported ------------------

create table client_manager.model_calls (
  id bigint generated always as identity primary key,
  client_id uuid references client_manager.clients (id) on delete cascade,
  build_id uuid references client_manager.builds (id) on delete set null,
  purpose text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6),
  latency_ms integer not null default 0,
  visitor_hash text not null,
  created_at timestamptz not null default now()
);

create index model_calls_visitor_idx on client_manager.model_calls (visitor_hash, created_at);
create index model_calls_created_idx on client_manager.model_calls (created_at);

-- Traversal ---------------------------------------------------------------------

-- Hybrid first hop: nearest Nodes by embedding, fused with full-text matches
-- (reciprocal rank fusion), so names and numbers are found as well as meaning.
create function client_manager.search_nodes(
  p_client uuid,
  p_query text,
  p_embedding extensions.vector(768),
  p_limit integer default 8
)
returns table (node_id bigint, score double precision, semantic double precision, lexical real)
language sql
stable
set search_path = extensions, public
as $$
  with terms as (
    select nullif(
      array_to_string(array(
        select quote_literal(lexeme) || ':*'
        from unnest(to_tsvector('english', p_query))
      ), ' | '),
      ''
    ) as tsq
  ),
  semantic as (
    select n.id, 1 - (n.embedding <=> p_embedding) as similarity,
           row_number() over (order by n.embedding <=> p_embedding) as rank
    from client_manager.nodes n
    where n.client_id = p_client and n.embedding is not null and p_embedding is not null
    order by n.embedding <=> p_embedding
    limit 30
  ),
  lexical as (
    select n.id, ts_rank_cd(n.search, to_tsquery('english', t.tsq)) as rank_score,
           row_number() over (order by ts_rank_cd(n.search, to_tsquery('english', t.tsq)) desc) as rank
    from client_manager.nodes n, terms t
    where n.client_id = p_client and t.tsq is not null
      and n.search @@ to_tsquery('english', t.tsq)
    order by rank_score desc
    limit 30
  )
  select coalesce(s.id, l.id) as node_id,
         coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + l.rank), 0) as score,
         s.similarity as semantic,
         l.rank_score as lexical
  from semantic s
  full join lexical l on l.id = s.id
  order by score desc, node_id
  limit greatest(1, least(p_limit, 25));
$$;

-- k-hop neighbourhood of some seed Nodes, walking Edges both ways.
-- `edge_id` is the Edge the walk arrived by; null for the seeds themselves.
-- Nearly every Node links to the client, so the client is a dead end: the
-- walk can reach it but not pass through it (unless it is a seed), or two
-- hops from anything would be the whole graph. Each Edge into the client
-- gets its own stand-in vertex (minus the Edge id), mapped back here.
create function client_manager.expand_nodes(
  p_client uuid,
  p_seeds bigint[],
  p_hops integer default 2,
  p_limit integer default 40
)
returns table (node_id bigint, edge_id bigint, depth double precision)
language plpgsql
stable
set search_path = extensions, public
as $$
declare
  v_root bigint;
begin
  select id into v_root from client_manager.nodes
  where client_id = p_client and is_root;
  if v_root = any(p_seeds) then
    v_root := null;
  end if;
  return query
  select distinct on (reached.node_id) reached.node_id, reached.edge_id, reached.depth
  from (
    select case when d.node < 0 then v_root else d.node end as node_id,
           nullif(d.edge, -1) as edge_id,
           d.agg_cost as depth
    from pgr_drivingDistance(
      format(
        'select id,
                case when source_id = %2$s then -id else source_id end as source,
                case when target_id = %2$s then -id else target_id end as target,
                1.0::float8 as cost, 1.0::float8 as reverse_cost
           from client_manager.edges where client_id = %1$L',
        p_client,
        coalesce(v_root, 0)
      ),
      p_seeds,
      greatest(1, least(p_hops, 3))::float8,
      directed => false,
      equicost => true
    ) d
  ) reached
  order by reached.node_id, reached.depth
  limit greatest(1, least(p_limit, 120));
end;
$$;

-- The best-supported route between two Nodes: Edges read with more confidence
-- cost less, so the path prefers facts the Sources state plainly.
create function client_manager.connect_nodes(
  p_client uuid,
  p_from bigint,
  p_to bigint
)
returns table (step integer, node_id bigint, edge_id bigint)
language plpgsql
stable
set search_path = extensions, public
as $$
begin
  return query
  select d.path_seq, d.node, nullif(d.edge, -1)
  from pgr_dijkstra(
    format(
      'select id, source_id as source, target_id as target,
              (1.5 - confidence * 0.5)::float8 as cost,
              (1.5 - confidence * 0.5)::float8 as reverse_cost
         from client_manager.edges where client_id = %L',
      p_client
    ),
    p_from,
    p_to,
    directed => false
  ) d
  order by d.path_seq;
end;
$$;

-- Access: server only -------------------------------------------------------------

alter table client_manager.clients enable row level security;
alter table client_manager.builds enable row level security;
alter table client_manager.sources enable row level security;
alter table client_manager.nodes enable row level security;
alter table client_manager.edges enable row level security;
alter table client_manager.evidence enable row level security;
alter table client_manager.repairs enable row level security;
alter table client_manager.messages enable row level security;
alter table client_manager.model_calls enable row level security;
-- No policies: anon and authenticated see nothing. The app connects as the
-- database owner, which bypasses RLS.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema client_manager from anon, authenticated';
    execute 'revoke execute on all functions in schema client_manager from public, anon, authenticated';
  end if;
end;
$$;

-- Storage: private bucket for uploaded Sources and portraits --------------------

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('client-manager', 'client-manager', false, 10485760)
    on conflict (id) do nothing;
  end if;
end;
$$;

-- Retention: visitors' clients expire after 30 days; samples stay ----------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'client-manager-delete-expired-clients',
      '41 3 * * *',
      $cron$delete from client_manager.clients where not is_sample and expires_at < now()$cron$
    );
  end if;
end;
$$;
