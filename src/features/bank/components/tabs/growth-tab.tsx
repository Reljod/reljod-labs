"use client";

import { AnimatePresence, motion } from "motion/react";
import type { GrowthView } from "../../domain/views";
import { RaiseForm } from "../growth/raise-form";
import { RequestCard } from "../growth/request-card";
import { GrowthRings } from "../growth/rings";
import { GrowthLoop } from "../growth/steps";
import { ListSkeleton, ReadError } from "../operations/figures";
import { Notice } from "../shell/command-dialog";
import { Empty, Panel } from "../ui";
import { useBank, useRead } from "../use-bank";

const REFRESH_MS = 8_000;

/**
 * The bank grows itself. A request is triaged by code, filed as an issue,
 * built by a scheduled agent, reviewed and merged by the PR pipeline, then
 * deployed. Each thing learned is a new growth ring.
 */
export function GrowthTab() {
  const { tab } = useBank();
  const visible = tab === "growth";
  const read = useRead<GrowthView>(
    "list_growth",
    {},
    {
      enabled: visible,
      refetchMs: visible ? REFRESH_MS : false,
    },
  );
  const view = read.data;

  return (
    <div
      className="tb-scroll min-h-0 flex-1"
      aria-busy={read.isFetching || undefined}
    >
      <div className="mx-auto max-w-6xl space-y-4 p-3 sm:p-4">
        <header className="space-y-1">
          <h2 className="font-mono text-lg font-bold tracking-[0.04em] uppercase">
            The bank grows itself
          </h2>
          <p className="text-sm text-ink-muted">
            Ask for something it cannot do yet. Code triages it, an agent builds
            it, the pipeline reviews and merges it, and it goes live.
          </p>
        </header>
        <GrowthLoop />

        {view && !view.githubReady ? (
          <Notice>
            This server has no GitHub token, so requests stop at Triaged,
            waiting for a token.
          </Notice>
        ) : null}

        {read.isPending ? (
          <ListSkeleton
            rows={3}
            height="h-40"
            label="Reading the Growth requests…"
          />
        ) : !view ? (
          <ReadError error={read.error} onRetry={() => void read.refetch()} />
        ) : (
          <>
            <Panel
              title="Growth rings"
              eyebrow={
                view.repo
                  ? `Learned through ${view.repo}`
                  : "What the bank learned"
              }
            >
              <GrowthRings changelog={view.changelog} />
            </Panel>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
              <section
                className="space-y-3"
                aria-labelledby="bank-growth-requests"
              >
                <h3
                  id="bank-growth-requests"
                  className="eyebrow border-ink border-b-2 pb-1 text-[0.7rem] font-bold"
                >
                  Requests
                </h3>
                {view.requests.length === 0 ? (
                  <Panel>
                    <Empty title="Nothing asked yet">
                      Ask here, or ask the Teller in chat for something the bank
                      cannot do.
                    </Empty>
                  </Panel>
                ) : (
                  <ul className="space-y-3" data-testid="bank-growth-requests">
                    <AnimatePresence initial={false}>
                      {view.requests.map((request) => (
                        <motion.li
                          key={request.id}
                          layout="position"
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.25 }}
                        >
                          <RequestCard request={request} />
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </section>
              <RaiseForm />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
