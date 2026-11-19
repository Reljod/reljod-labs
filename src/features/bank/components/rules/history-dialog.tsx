"use client";

import { type ResolvedRule, ruleDef } from "../../domain/rules";
import type { RuleHistoryView } from "../../domain/views";
import { ListSkeleton, ReadError } from "../operations/figures";
import { formatStamp } from "../shell/time";
import { Badge, Dialog, Empty } from "../ui";
import { useRead } from "../use-bank";

/** Every saved Version of one Rule, newest first: who, when, why, and what it said. */
export function HistoryDialog({
  rule,
  onClose,
}: {
  rule: ResolvedRule;
  onClose: () => void;
}) {
  const read = useRead<RuleHistoryView>("get_rule_history", {
    ruleId: rule.id,
  });
  const def = ruleDef(rule.id);
  const versions = [...(read.data?.versions ?? [])].sort(
    (a, b) => b.version - a.version,
  );
  return (
    <Dialog title={`History: ${rule.title}`} onClose={onClose} wide>
      {read.isPending ? (
        <ListSkeleton rows={3} height="h-16" label="Reading the history…" />
      ) : !read.data ? (
        <ReadError error={read.error} onRetry={() => void read.refetch()} />
      ) : (
        <ol className="space-y-3" data-testid="bank-rule-history">
          {versions.map((version) => (
            <li
              key={version.version}
              className="outline-box rounded-sm bg-paper px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={version.version === rule.version ? "ink" : "neutral"}
                >
                  Version {version.version}
                </Badge>
                {!version.enabled ? <Badge tone="amber">Off</Badge> : null}
                <span className="text-xs text-ink-muted">
                  {version.staffName} · {formatStamp(version.createdAt)}
                </span>
              </div>
              <p className="mt-1.5 text-sm">
                {def ? def.sentence(version.params) : ""}
              </p>
              {version.note ? (
                <p className="mt-1 text-xs text-ink-muted">“{version.note}”</p>
              ) : null}
            </li>
          ))}
          <li className="outline-box rounded-sm border-dashed bg-marble px-3 py-2">
            <Badge>Default</Badge>
            <p className="mt-1.5 text-sm text-ink-muted">
              {rule.defaultSentence}
            </p>
          </li>
          {versions.length === 0 ? (
            <li>
              <Empty title="Never edited">
                This Rule still runs on its Default.
              </Empty>
            </li>
          ) : null}
        </ol>
      )}
    </Dialog>
  );
}
