"use client";

import { useId, useState } from "react";
import { LIMITS } from "../../domain/limits";
import { can } from "../../domain/permissions";
import { OutcomeNote } from "../shell/command-dialog";
import {
  Button,
  cx,
  Field,
  inputClass,
  Panel,
  segmentClass,
  segmentsClass,
} from "../ui";
import { useBank, useCommand } from "../use-bank";

type Kind = "feature" | "bug";

/**
 * Asks the bank to learn something, or to fix a bug: a Growth request. What
 * is typed is quoted as untrusted text in the issue; code triages it and the
 * Growth Rule may refuse it, which is shown here.
 */
export function RaiseForm() {
  const { activeStaff, openTab } = useBank();
  const raise = useCommand();
  const [kind, setKind] = useState<Kind>("feature");
  const [title, setTitle] = useState("");
  const [want, setWant] = useState("");
  const [evidence, setEvidence] = useState("");
  const [tried, setTried] = useState(false);
  const ids = { title: useId(), want: useId(), evidence: useId() };
  const allowed = can(activeStaff, "growth.raise");

  const titleError =
    title.trim().length < 6 ? "A title of at least 6 characters." : null;
  const wantError =
    want.trim().length < 12
      ? "Say what you want in at least 12 characters."
      : null;

  const submit = async () => {
    setTried(true);
    if (titleError || wantError) return;
    const outcome = await raise.run("raise_request", {
      kind,
      title: title.trim(),
      want: want.trim(),
      ...(kind === "bug" && evidence.trim()
        ? { evidence: evidence.trim() }
        : {}),
    });
    if (outcome) {
      setTitle("");
      setWant("");
      setEvidence("");
      setTried(false);
    }
  };

  return (
    <Panel title="Ask the bank to grow" eyebrow="A feature it lacks, or a bug">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="text-xs text-ink-muted">
          The Teller does this too when you ask it for something the bank cannot
          do yet.{" "}
          <button
            type="button"
            onClick={() => openTab("chat")}
            className="font-semibold text-federal-blue underline"
          >
            Ask the Teller
          </button>
        </p>
        <fieldset className={cx(segmentsClass, "m-0 min-w-0 border-0 p-0")}>
          <legend className="sr-only">Kind of request</legend>
          {(["feature", "bug"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={kind === item}
              onClick={() => setKind(item)}
              className={segmentClass(kind === item)}
            >
              {item === "feature" ? "Feature" : "Bug"}
            </button>
          ))}
        </fieldset>
        <Field
          label="Title"
          htmlFor={ids.title}
          error={tried ? titleError : null}
        >
          <input
            id={ids.title}
            value={title}
            maxLength={LIMITS.growthTitleChars}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={(tried && Boolean(titleError)) || undefined}
            placeholder={
              kind === "bug"
                ? "Statement totals are off by a day"
                : "Joint accounts"
            }
            className={inputClass}
            data-testid="bank-growth-title"
          />
        </Field>
        <Field
          label="What you want"
          htmlFor={ids.want}
          error={tried ? wantError : null}
          hint={`${want.length} / ${LIMITS.growthWantChars}`}
        >
          <textarea
            id={ids.want}
            value={want}
            rows={4}
            maxLength={LIMITS.growthWantChars}
            onChange={(event) => setWant(event.target.value)}
            aria-invalid={(tried && Boolean(wantError)) || undefined}
            className={inputClass}
            data-testid="bank-growth-want"
          />
        </Field>
        {kind === "bug" ? (
          <Field
            label="Evidence (optional)"
            htmlFor={ids.evidence}
            hint="What you did, what happened, what you expected."
          >
            <textarea
              id={ids.evidence}
              value={evidence}
              rows={3}
              maxLength={600}
              onChange={(event) => setEvidence(event.target.value)}
              className={inputClass}
            />
          </Field>
        ) : null}
        <div className={cx("flex flex-wrap items-center gap-2")}>
          <Button
            type="submit"
            variant="primary"
            pending={raise.pending}
            pendingLabel="Raising…"
            disabled={!allowed}
            data-testid="bank-growth-raise"
          >
            Raise the request
          </Button>
          <span className="text-xs text-ink-muted">
            Up to {LIMITS.growthPerDay} a day. Code triages it; the Growth Rule
            may refuse it.
          </span>
        </div>
        <OutcomeNote command={raise} />
      </form>
    </Panel>
  );
}
