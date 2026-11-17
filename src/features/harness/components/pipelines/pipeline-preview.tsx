"use client";

import type { PipelineSpec } from "../../domain/pipeline";
import { Badge, Button, Panel } from "../ui";
import { PipelineGraph } from "./flow";
import { layoutPipeline } from "./layout";

/** A Pipeline's shape before any Run exists: its Steps, what runs together and what it takes in. */
export function PipelinePreview({
  spec,
  selectedStepId,
  onSelectStep,
  onOpenSkill,
  onAskAgent,
}: {
  spec: PipelineSpec;
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
  onOpenSkill: (skillId: string) => void;
  onAskAgent: () => void;
}) {
  const layout = layoutPipeline(spec);
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 font-mono text-base font-bold uppercase">
          {spec.title}
          <Badge>{spec.steps.length} Steps</Badge>
          {layout.parallelism > 1 ? (
            <Badge tone="blue">Up to {layout.parallelism} at once</Badge>
          ) : null}
        </h2>
        <p className="max-w-prose text-sm text-ink-muted">{spec.summary}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <button
            type="button"
            onClick={() => onOpenSkill(spec.skillId)}
            className="font-medium text-federal-blue underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-federal-blue"
          >
            Its Skill
          </button>
          <button
            type="button"
            onClick={() => onOpenSkill(spec.rulebookSkillId)}
            className="font-medium text-federal-blue underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-federal-blue"
          >
            Its Rulebook
          </button>
        </p>
      </header>

      <Panel
        title="Steps"
        bodyClassName="p-0"
        actions={
          <Button size="sm" variant="secondary" onClick={onAskAgent}>
            Ask the Agent to run it
          </Button>
        }
      >
        <PipelineGraph
          spec={spec}
          run={null}
          selectedStepId={selectedStepId}
          onSelect={onSelectStep}
          now={0}
          label={`${spec.title} Pipeline, its Steps`}
        />
      </Panel>

      {spec.inputSchema.length > 0 ? (
        <Panel title="What it takes in" bodyClassName="p-0">
          <ul className="divide-y divide-ink/10">
            {spec.inputSchema.map((field) => (
              <li key={field.name} className="px-4 py-2 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">
                    {field.name}
                  </span>
                  <Badge>{field.type}</Badge>
                  {field.required ? <Badge tone="amber">Required</Badge> : null}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {field.description}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
