import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { sql } from "./db";

/**
 * The bank's own record of its Workflow runs (`bank.workflow_runs`), which
 * Operations shows live: what each run is for, the steps it has taken and
 * what it is sleeping until. Called only from Workflow steps.
 */

/** Opens (or finds) the record of the run that handles one outbox message. */
export async function openRun(input: {
  owner: Owner;
  outboxId: number;
  kind: string;
  subject: string;
  runId: string;
}): Promise<string> {
  const [row] = await sql()<{ id: string }[]>`
    insert into bank.workflow_runs (owner, outbox_id, kind, subject, run_id)
    values (${input.owner}, ${input.outboxId}, ${input.kind}, ${input.subject.slice(0, 120)}, ${input.runId})
    on conflict (outbox_id) do update set run_id = excluded.run_id
    returning id`;
  if (!row) throw new Error("The run was not recorded");
  return row.id;
}

/** Adds a line to a run's trail, and says what it is doing now. */
export async function noteRun(input: {
  owner: Owner;
  id: string;
  step: string;
  note: string;
  status?: "running" | "sleeping" | "waiting";
  wakeAt?: string | null;
}): Promise<void> {
  const line = {
    name: input.step,
    at: new Date().toISOString(),
    note: input.note.slice(0, 240),
  };
  await sql()`
    update bank.workflow_runs set
      steps = (case when jsonb_array_length(steps) >= 60 then steps - 0 else steps end) || ${sql().json(line)}::jsonb,
      status = ${input.status ?? "running"},
      wake_at = ${input.wakeAt ?? null}
    where owner = ${input.owner} and id = ${input.id}
      and status in ('running', 'sleeping', 'waiting')`;
}

/** Ends a run's record and its outbox message together. */
export async function closeRun(input: {
  owner: Owner;
  id: string;
  outboxId: number;
  status: "completed" | "failed";
  detail: string;
}): Promise<void> {
  await sql().begin(async (tx) => {
    await tx`
      update bank.workflow_runs set status = ${input.status}, detail = ${input.detail.slice(0, 300)},
             wake_at = null, ended_at = now()
      where owner = ${input.owner} and id = ${input.id}`;
    await tx`
      update bank.outbox set status = ${input.status === "completed" ? "done" : "failed"},
             last_error = ${input.status === "failed" ? input.detail.slice(0, 300) : null},
             finished_at = now()
      where owner = ${input.owner} and id = ${input.outboxId}`;
  });
}
