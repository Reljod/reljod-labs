"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, keys } from "../api";
import { Loading } from "../ui";
import { Popover } from "./popover";

/** What the Agent can reach: the Skills it may load, and where its tools come from. */
export function SkillsPopover({
  onOpenSkill,
}: {
  onOpenSkill: (skillId: string) => void;
}) {
  return (
    <Popover label="Skills and tools" align="right">
      {(close) => <Body onOpenSkill={onOpenSkill} close={close} />}
    </Popover>
  );
}

function Body({
  onOpenSkill,
  close,
}: {
  onOpenSkill: (skillId: string) => void;
  close: () => void;
}) {
  const skills = useQuery({ queryKey: keys.skills, queryFn: api.skills.list });
  return (
    <div className="space-y-3">
      <div>
        <p className="font-mono text-[0.65rem] font-bold tracking-[0.08em] text-ink-muted uppercase">
          Skills the Agent can load
        </p>
        {skills.isPending ? (
          <Loading rows={2} className="mt-2" />
        ) : skills.isError ? (
          <p className="mt-1 text-ink-muted">The Skills did not load.</p>
        ) : (
          <ul className="hx-scroll mt-1 max-h-60 space-y-1 overflow-y-auto">
            {skills.data.map((skill) => (
              <li key={skill.id}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenSkill(skill.id);
                    close();
                  }}
                  className="w-full rounded-sm px-1.5 py-1 text-left hover:bg-marble focus-visible:outline-2 focus-visible:outline-federal-blue"
                >
                  <span className="block text-sm font-medium">
                    {skill.name}
                  </span>
                  <span className="line-clamp-2 block text-xs text-ink-muted">
                    {skill.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="border-ink/10 border-t pt-2 text-xs text-ink-muted">
        Its tools come from the Harness MCP server, the same one Claude can
        connect to.{" "}
        <Link
          href="/demos/harness/mcp"
          className="font-medium text-federal-blue underline underline-offset-2"
        >
          Connect Claude
        </Link>
      </p>
    </div>
  );
}
