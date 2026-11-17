"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import type { ParameterValue } from "../../domain/rules";
import { api, keys, messageOf } from "../api";
import { useController, useHarness } from "../harness-context";
import type { RuleCardHandle } from "../skills/rule-card";
import { RulebookEditor } from "../skills/rulebook-editor";
import { SkillEditor } from "../skills/skill-editor";
import { SkillList } from "../skills/skill-list";
import {
  Button,
  cx,
  DoneNote,
  Empty,
  ErrorNote,
  Loading,
  useWrite,
} from "../ui";

const MCP_PAGE = "/demos/harness/mcp";

/** Fetches the Plugin zip and hands it to the browser. Rejects with the server's message. */
async function downloadPlugin(): Promise<string> {
  const response = await fetch(api.plugin.href(), { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "The plugin could not be built. Try again.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "jod-harness-bank.zip";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `Downloaded ${Math.max(1, Math.round(blob.size / 1024))} KB. Unzip it and run claude --plugin-dir.`;
}

/**
 * Skills: the instructions the Agent loads, as `SKILL.md`, and each
 * Pipeline's Rulebook as Rule cards an admin edits (ADR 0015). Two panes: the
 * list, and the editor of the Skill that is open (`?skill=`, or `?rule=` for a
 * Rule's own card). A Staff member who may not edit sees everything read-only.
 */
export default function SkillsTab() {
  const { can, place, openTab } = useHarness();
  const skills = useQuery({
    queryKey: keys.skills,
    queryFn: () => api.skills.list(),
  });
  const rules = useQuery({
    queryKey: keys.rules(),
    queryFn: () => api.rules.list(),
  });

  const paramSkill = place.params.skill ?? null;
  const paramRule = place.params.rule ?? null;
  const list = skills.data ?? [];

  const ruleBook = useMemo(() => {
    const rule = paramRule
      ? rules.data?.find((item) => item.spec.id === paramRule)
      : null;
    return rule
      ? (list.find(
          (skill) =>
            skill.kind === "rulebook" &&
            skill.pipelineId === rule.spec.pipelineId,
        ) ?? null)
      : null;
  }, [paramRule, rules.data, list]);

  const explicit = paramSkill ?? ruleBook?.id ?? null;
  // On a wide screen something is always open; on a phone the list shows until a Skill is chosen.
  const selected =
    list.find((skill) => skill.id === explicit) ??
    (explicit ? null : (list[0] ?? null));
  const showEditor = explicit !== null;

  const canEditSkill = can("skill.edit");
  const canEditRule = can("rule.edit");
  const reason =
    "Only an admin edits Skills and Rules. You can read everything here; switch Staff to try editing.";

  const select = useCallback(
    (id: string) => openTab("skills", { skill: id, rule: null }),
    [openTab],
  );
  const back = useCallback(
    () => openTab("skills", { skill: null, rule: null }),
    [openTab],
  );

  // Demo mode ------------------------------------------------------------------
  const cards = useRef(new Map<string, RuleCardHandle>());
  const waiters = useRef(new Map<string, Set<() => void>>());
  const openRuleRef = useRef<string | null>(null);
  const register = useCallback(
    (ruleId: string, handle: RuleCardHandle | null) => {
      if (handle) {
        cards.current.set(ruleId, handle);
        for (const wake of waiters.current.get(ruleId) ?? []) wake();
        waiters.current.delete(ruleId);
      } else cards.current.delete(ruleId);
    },
    [],
  );
  const cardOf = () => {
    const id = openRuleRef.current;
    const handle = id ? cards.current.get(id) : undefined;
    if (!id || !handle) throw new Error("Open a Rule first.");
    return handle;
  };

  useController("skills", {
    openRule(ruleId) {
      openRuleRef.current = ruleId;
      openTab("skills", { rule: ruleId, skill: null });
      return new Promise<void>((resolve, reject) => {
        if (cards.current.has(ruleId)) return resolve();
        const timer = setTimeout(() => {
          waiters.current.get(ruleId)?.delete(wake);
          reject(new Error("That Rule's card did not open."));
        }, 8_000);
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        const set = waiters.current.get(ruleId) ?? new Set();
        set.add(wake);
        waiters.current.set(ruleId, set);
      });
    },
    async setParameter(name: string, value: ParameterValue) {
      cardOf().setParameter(name, value);
    },
    async save() {
      await cardOf().save();
    },
  });

  const plugin = useWrite(downloadPlugin);

  if (skills.isPending || rules.isPending) {
    return (
      <div className="p-4">
        <Loading rows={5} />
      </div>
    );
  }
  if (skills.isError || rules.isError) {
    return (
      <div className="p-4">
        <ErrorNote
          onRetry={() => {
            void skills.refetch();
            void rules.refetch();
          }}
        >
          {messageOf(skills.error ?? rules.error)}
        </ErrorNote>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label="Skills"
        className={cx(
          "min-h-0 w-full flex-col border-ink bg-paper lg:flex lg:w-80 lg:shrink-0 lg:border-r-2",
          showEditor ? "hidden" : "flex",
        )}
      >
        <div className="shrink-0 space-y-2 border-ink border-b-2 p-3">
          <p className="text-xs text-ink-muted">
            What the Agent reads, as SKILL.md. Claude gets the same Skills from
            the plugin.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {can("plugin.download") ? (
              <Button
                size="sm"
                variant="primary"
                pending={plugin.pending}
                pendingLabel="Preparing…"
                onClick={() => void plugin.run()}
              >
                Download Claude plugin
              </Button>
            ) : null}
            <a
              href={MCP_PAGE}
              className="text-xs font-medium text-federal-blue underline underline-offset-2"
            >
              Connect Claude (MCP)
            </a>
          </div>
          <ErrorNote className="text-xs">{plugin.error}</ErrorNote>
          {typeof plugin.result === "string" ? (
            <DoneNote className="text-xs">{plugin.result}</DoneNote>
          ) : null}
        </div>
        <SkillList
          skills={list}
          selectedId={selected?.id ?? null}
          onSelect={select}
        />
      </aside>

      <section
        aria-label="Editor"
        className={cx(
          "min-h-0 min-w-0 flex-1 flex-col bg-paper lg:flex",
          showEditor ? "flex" : "hidden",
        )}
      >
        {!selected ? (
          <Empty
            title={
              explicit ? "That Skill is not in this Workspace" : "No Skills yet"
            }
          >
            {explicit
              ? "Pick one from the list."
              : "Skills appear here once the Harness is set up."}
          </Empty>
        ) : selected.kind === "rulebook" ? (
          <RulebookEditor
            key={selected.id}
            skill={selected}
            rules={rules.data}
            canEdit={canEditRule}
            readOnlyReason={reason}
            openRuleId={paramRule}
            register={register}
            onBack={back}
          />
        ) : (
          <SkillEditor
            key={selected.id}
            skill={selected}
            canEdit={canEditSkill}
            readOnlyReason={reason}
            onBack={back}
          />
        )}
      </section>
    </div>
  );
}
