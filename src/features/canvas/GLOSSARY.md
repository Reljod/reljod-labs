# Canvas

An analyst that answers a question about data with a small working interface instead of a paragraph. The interface is an MCP App, so the same View renders on the page and inside Claude.

## Language

**Analyst**:
The one agent. It explores the Catalog, writes and runs queries and code in the Sandbox, loads Skills, and answers by creating Views. It reaches everything through the Canvas MCP server.
_Avoid_: Assistant, bot, copilot

**Question**:
One message a person sends the Analyst, and everything the Analyst does to answer it. Capped in turns, Sandbox seconds and USD.
_Avoid_: Prompt, request, run

**Conversation**:
The Questions and answers of one sitting, with the Views they produced laid out beside it.
_Avoid_: Session, Thread, chat

**Catalog**:
The Tables the Analyst may ask about: the open data of the fictional Republic of Meridia, one banking Table, and the Owner's Uploads.
_Avoid_: Database, datasets, schema

**Table**:
One named set of rows in the Catalog, with typed Columns.

**Upload**:
A CSV or Parquet file an Owner brought. It is profiled in the Sandbox, becomes a Table in that Owner's Catalog only, and is never shared.
_Avoid_: Attachment, source, file

**Restricted column**:
A Column whose values are never returned row by row. A Query may only aggregate it, over groups of at least the minimum group size. The Guard enforces it; the Analyst cannot switch it off.

**Query**:
What produces a View's rows: SQL with named Parameters, or code over the results of such SQL. It is saved with the View, so it can run again without a model.

**Guard**:
The code between a Query and the data. It reads the parsed SQL, refuses what the Rules forbid (a denied Table, a Restricted column outside an aggregate, a file read) and adds the minimum group size. Only guarded SQL runs.

**Run**:
One execution of a Query or of the Analyst's code in the Sandbox: its text, duration, row count and outcome. Every Run is on the Trail.
_Avoid_: Job, execution, call

**Sandbox**:
The Vercel Sandbox (a microVM with no network) where every Query and all the Analyst's code runs, with the Catalog on disk. One per Owner.

**View**:
One answer as an interface: a chart, table, map or stat tiles, with Controls, Annotations, a Finding and the Query behind it. A View is data in the View grammar, never code.
_Avoid_: Widget, artifact, dashboard, chart (a chart is one kind of View)

**View grammar**:
The typed, versioned description every View is written in (`canvas.view/1`). Trusted code draws it; the Analyst only fills it in.

**Control**:
A slider, select or date range on a View, bound to a Parameter. Moving it runs the View's Query again with the new value. No model is called.

**Parameter**:
A named value a Query takes (`$from`, `$price_change`). A View carries its Parameters and their current values.

**Brush**:
Dragging across a chart to choose a range. It sets two Parameters, like a Control.

**Link**:
Views that share a Parameter by name. Changing it in one runs the others again.
_Avoid_: Cross-filter (the effect), binding

**Annotation**:
A mark on a View that points at what matters: a point, a band or a line, with a few words.

**Finding (of a View)**:
The View's note in words: what the Analyst concluded. Its numbers are Claims.

**Claim**:
One number the Analyst states, with where it comes from in the View's rows (a column, an aggregate, a filter). Code recomputes it.

**Verified**:
A View whose every Claim matches its recomputed value within the tolerance, and whose Finding states no figure that is not a Claim. Otherwise the View is Flagged. Only code decides this.
_Avoid_: Checked, validated, approved

**Rule**:
One sentence with Parameters that the Guard or a check applies: the verification tolerance, Restricted columns, the row cap, the largest pie. Data, editable by the Owner.

**Rulebook**:
All of an Owner's Rules at one Version. Every View records the Version it was made under.

**Check finding**:
What a check returns when a View's spec or a Query breaks a Rule: the Rule, what was found, and whether it blocks. Only code returns one.
_Avoid_: Finding alone (that is the View's note), error, warning

**Show the work**:
The drawer on a View with its Query, the guarded SQL that ran, the Runs, the row counts and the Claims as recomputed.

**Board**:
Views an Owner pinned together under a name, arranged, and refreshed later.
_Avoid_: Dashboard, report

**Refresh**:
Running every Query of a Board again, with no model, as a durable workflow, and reporting what changed. It can repeat on a Schedule.

**App**:
The single HTML document that draws a View from the View grammar. The MCP server serves it as an MCP App resource (`ui://canvas/view.html`); the page and Claude each render it in a sandboxed frame.
_Avoid_: Widget, renderer, iframe

**Host**:
Whatever renders the App and carries its messages to the MCP server: the Canvas page, or Claude.

**Bridge**:
The messages between the App and its Host (MCP Apps: `ui/initialize`, tool input and result, `tools/call`).

**Trail**:
The append-only record of every Question, model turn, tool call, Run, View, Rule edit and Refresh.
_Avoid_: Log, history, audit log

**Skill**:
A `SKILL.md` playbook the Analyst loads on demand: choosing a chart, decomposing a time series, finding anomalies, writing fast DuckDB, explaining a variance.

**Replay**:
A recorded Question and its events, played back on the page without a model or a Sandbox.

**Owner**:
Who saved data belongs to (see Access). Every Conversation, View, Board, Upload, Rulebook and Trail event is one Owner's.
