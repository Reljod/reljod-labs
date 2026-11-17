"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  renderSkillMd,
  SKILL_LIMITS,
  type SkillText,
  type SkillVersion,
  type SkillView,
  sameSkillText,
  skillProblems,
} from "../../domain/skills";
import { api, keys, messageOf } from "../api";
import {
  Badge,
  Button,
  ConfirmDialog,
  cx,
  Dialog,
  DoneNote,
  ErrorNote,
  Field,
  inputClass,
  Loading,
  Markdown,
  Tabs,
  useWrite,
} from "../ui";
import { DiffView } from "./diff-view";

type BodyView = "edit" | "preview" | "changes";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function Count({ value, max }: { value: number; max: number }) {
  return (
    <span
      className={cx(
        "font-mono text-[0.65rem]",
        value > max ? "text-seal-red" : "text-ink-muted",
      )}
    >
      {value.toLocaleString("en-GB")} / {max.toLocaleString("en-GB")}
    </span>
  );
}

/**
 * A Skill as `SKILL.md`: name and description as their own fields with live
 * counts and the same checks the server makes, the body in a monospace
 * editor with Preview and a Changes view against the Default, and Save,
 * Discard, Restore default and History. Read-only for a Role that may not edit.
 */
export function SkillEditor({
  skill,
  canEdit,
  readOnlyReason,
  onBack,
}: {
  skill: SkillView;
  canEdit: boolean;
  readOnlyReason: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const base = useMemo<SkillText>(
    () => ({
      name: skill.name,
      description: skill.description,
      body: skill.body,
    }),
    [skill.name, skill.description, skill.body],
  );
  const [draft, setDraft] = useState<SkillText>(base);
  const [note, setNote] = useState("");
  const [view, setView] = useState<BodyView>("edit");
  const [history, setHistory] = useState(false);
  const [restoring, setRestoring] = useState<number | null | "default">(null);

  // Another Skill, or a new Version, replaces what the editor holds.
  const identity = `${skill.id}:${skill.version}`;
  const [seen, setSeen] = useState(identity);
  useEffect(() => {
    if (seen === identity) return;
    setSeen(identity);
    setDraft(base);
    setNote("");
  }, [identity, seen, base]);

  const dirty = !sameSkillText(base, draft);
  const problems = useMemo(() => skillProblems(draft), [draft]);
  const problemOf = (field: "name" | "description" | "body") =>
    problems.find((problem) => problem.field === field)?.message;
  const differsFromDefault = !sameSkillText(skill.default, base);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.skills }),
      queryClient.invalidateQueries({ queryKey: keys.skill(skill.id) }),
      queryClient.invalidateQueries({ queryKey: ["harness", "audit"] }),
    ]);

  const save = useWrite(async () => {
    const result = await api.skills.save(skill.id, {
      ...draft,
      note: note.trim() || undefined,
    });
    await refresh();
    setNote("");
    return `Saved as Version ${result.skill.version}.`;
  });

  const readOnly = !canEdit;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 space-y-2 border-ink/10 border-b px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="lg:hidden"
            onClick={onBack}
          >
            ← Skills
          </Button>
          <div className="min-w-0 flex-1">
            <p className="eyebrow text-[0.65rem] text-ink-muted">Skill</p>
            <h2 className="truncate font-mono text-sm font-bold">{skill.id}</h2>
          </div>
          {dirty ? <Badge tone="amber">unsaved</Badge> : null}
          <Badge tone={skill.version === 0 ? "neutral" : "blue"}>
            {skill.version === 0 ? "default" : `v${skill.version}`}
          </Badge>
          <Button size="sm" onClick={() => setHistory(true)}>
            History
          </Button>
          {canEdit && differsFromDefault ? (
            <Button size="sm" onClick={() => setRestoring("default")}>
              Restore default
            </Button>
          ) : null}
        </div>
        {skill.savedBy && skill.savedAt ? (
          <p className="text-xs text-ink-muted">
            Version {skill.version} saved by {skill.savedBy.name},{" "}
            {WHEN.format(new Date(skill.savedAt))}.
          </p>
        ) : (
          <p className="text-xs text-ink-muted">
            The Default that ships with the Harness.
          </p>
        )}
        {readOnly ? (
          <p className="rounded-sm border border-ink/15 bg-marble/60 px-3 py-1.5 text-xs text-ink-muted">
            {readOnlyReason}
          </p>
        ) : null}
      </header>

      <div className="hx-scroll min-h-0 flex-1 space-y-4 px-3 py-4 sm:px-4">
        <Field
          label={
            <span className="flex items-center justify-between gap-2">
              Name{" "}
              <Count value={draft.name.length} max={SKILL_LIMITS.nameChars} />
            </span>
          }
          htmlFor="skill-name"
          hint="Also the folder name in the Claude plugin."
          error={problemOf("name")}
        >
          <input
            id="skill-name"
            className={cx(inputClass, "font-mono")}
            value={draft.name}
            readOnly={readOnly}
            aria-invalid={Boolean(problemOf("name"))}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </Field>

        <Field
          label={
            <span className="flex items-center justify-between gap-2">
              Description{" "}
              <Count
                value={draft.description.length}
                max={SKILL_LIMITS.descriptionChars}
              />
            </span>
          }
          htmlFor="skill-description"
          hint="One line that says when to use the Skill. The Agent sees only this until it loads the Skill."
          error={problemOf("description")}
        >
          <textarea
            id="skill-description"
            rows={3}
            className={inputClass}
            value={draft.description}
            readOnly={readOnly}
            aria-invalid={Boolean(problemOf("description"))}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
          />
        </Field>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs
              size="sm"
              label="Instructions view"
              idPrefix="skill-body"
              value={view}
              onChange={setView}
              tabs={[
                { id: "edit", label: readOnly ? "Instructions" : "Edit" },
                { id: "preview", label: "Preview" },
                {
                  id: "changes",
                  label: "Changed from default",
                  badge:
                    differsFromDefault || dirty ? (
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-brass"
                      />
                    ) : null,
                },
              ]}
            />
            <Count value={draft.body.length} max={SKILL_LIMITS.bodyChars} />
          </div>
          {view === "edit" ? (
            <>
              <textarea
                aria-label="Instructions (Markdown)"
                aria-invalid={Boolean(problemOf("body"))}
                className={cx(
                  inputClass,
                  "min-h-[22rem] resize-y font-mono text-[0.8rem] leading-5",
                )}
                spellCheck={false}
                value={draft.body}
                readOnly={readOnly}
                onChange={(event) =>
                  setDraft({ ...draft, body: event.target.value })
                }
              />
              {problemOf("body") ? (
                <p role="alert" className="text-xs text-seal-red">
                  {problemOf("body")}
                </p>
              ) : null}
            </>
          ) : view === "preview" ? (
            <div className="min-h-[12rem] rounded-sm border border-ink/15 bg-paper p-4">
              <Markdown text={draft.body} />
            </div>
          ) : (
            <DiffView
              before={renderSkillMd(skill.default)}
              after={renderSkillMd(draft)}
              beforeLabel="Default"
              afterLabel={dirty ? "Your edit" : "Now"}
            />
          )}
        </div>
      </div>

      {canEdit ? (
        <footer className="shrink-0 space-y-2 border-ink/10 border-t bg-marble/40 px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Note for this Version (optional)"
              placeholder="Note for this Version (optional)"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={cx(inputClass, "min-w-48 flex-1")}
            />
            <Button
              variant="primary"
              pending={save.pending}
              pendingLabel="Saving…"
              disabled={!dirty || problems.length > 0}
              onClick={() => void save.run()}
            >
              Save as new Version
            </Button>
            {dirty ? (
              <Button
                variant="ghost"
                disabled={save.pending}
                onClick={() => {
                  setDraft(base);
                  setNote("");
                  save.reset();
                }}
              >
                Discard
              </Button>
            ) : null}
          </div>
          <ErrorNote>{save.error}</ErrorNote>
          {!dirty && typeof save.result === "string" ? (
            <DoneNote>{save.result}</DoneNote>
          ) : null}
        </footer>
      ) : null}

      {history ? (
        <SkillHistory
          skill={skill}
          canEdit={canEdit}
          onClose={() => setHistory(false)}
          onRestore={(version) => setRestoring(version)}
        />
      ) : null}
      {restoring !== null ? (
        <ConfirmDialog
          title={
            restoring === "default"
              ? `Restore the Default of "${skill.id}"?`
              : `Restore Version ${restoring} of "${skill.id}"?`
          }
          confirm={
            restoring === "default" ? "Restore default" : "Restore this Version"
          }
          pendingLabel="Restoring…"
          onClose={() => setRestoring(null)}
          onConfirm={async () => {
            const result = await api.skills.restore(
              skill.id,
              restoring === "default" ? {} : { version: restoring },
            );
            await refresh();
            return `Saved as Version ${result.skill.version}. History keeps every earlier Version.`;
          }}
        >
          This saves the{" "}
          {restoring === "default" ? "Default" : `earlier Version ${restoring}`}{" "}
          as a new Version. {dirty ? "Your unsaved edit is dropped. " : ""}
          Nothing in the history is deleted.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function SkillHistory({
  skill,
  canEdit,
  onClose,
  onRestore,
}: {
  skill: SkillView;
  canEdit: boolean;
  onClose: () => void;
  onRestore: (version: number) => void;
}) {
  const history = useQuery({
    queryKey: keys.skill(skill.id),
    queryFn: () => api.skills.get(skill.id),
  });
  const [viewing, setViewing] = useState<SkillVersion | null>(null);
  return (
    <Dialog title={`History: ${skill.id}`} onClose={onClose} wide>
      {history.isPending ? (
        <Loading rows={3} />
      ) : history.isError ? (
        <ErrorNote onRetry={() => void history.refetch()}>
          {messageOf(history.error)}
        </ErrorNote>
      ) : history.data.history.length === 0 ? (
        <p className="text-ink-muted">Never edited: the Default is in force.</p>
      ) : (
        <div className="space-y-3">
          <ol className="space-y-2">
            {history.data.history.map((version) => {
              const current = version.version === skill.version;
              return (
                <li
                  key={version.version}
                  className="flex flex-wrap items-center gap-2 rounded-sm border border-ink/15 p-2.5"
                >
                  <Badge tone={current ? "blue" : "neutral"}>
                    v{version.version}
                  </Badge>
                  {current ? <Badge tone="green">in force</Badge> : null}
                  <span className="min-w-0 flex-1 text-xs text-ink-muted [overflow-wrap:anywhere]">
                    {version.savedBy.name} ·{" "}
                    {WHEN.format(new Date(version.createdAt))}
                    {version.note ? ` · ${version.note}` : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setViewing(
                        viewing?.version === version.version ? null : version,
                      )
                    }
                  >
                    {viewing?.version === version.version ? "Hide" : "View"}
                  </Button>
                  {canEdit && !current ? (
                    <Button
                      size="sm"
                      onClick={() => onRestore(version.version)}
                    >
                      Restore
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {viewing ? (
            <DiffView
              before={renderSkillMd(skill.default)}
              after={renderSkillMd(viewing)}
              beforeLabel="Default"
              afterLabel={`Version ${viewing.version}`}
            />
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
