import { useId } from "react";
import { LIMITS } from "../domain/limits";

const INK = "var(--color-ink)";
const MUTED = "var(--color-ink-muted)";
const PAPER = "var(--color-paper)";
const MARBLE = "var(--color-marble)";
const BLUE = "var(--color-federal-blue)";
const BRASS = "var(--color-brass)";
const RED = "var(--color-seal-red)";
const GREEN_SCREEN = "#0d1f14";

function Box({
  x,
  y,
  w,
  h,
  title,
  line,
  fill = PAPER,
  dark = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  line?: string;
  fill?: string;
  dark?: boolean;
}) {
  return (
    <g>
      <rect x={x + 4} y={y + 4} width={w} height={h} rx={2} fill={INK} />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2}
        fill={fill}
        stroke={INK}
        strokeWidth={2}
      />
      <text
        x={x + w / 2}
        y={line ? y + h / 2 - 4 : y + h / 2 + 5}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize={13}
        fontWeight={700}
        fill={dark ? "#7cfc9a" : INK}
      >
        {title}
      </text>
      {line ? (
        <text
          x={x + w / 2}
          y={y + h / 2 + 14}
          textAnchor="middle"
          fontSize={11}
          fill={dark ? "#b7f5c6" : MUTED}
        >
          {line}
        </text>
      ) : null}
    </g>
  );
}

function Arrow({
  d,
  label,
  lx,
  ly,
  marker,
  color = BLUE,
}: {
  d: string;
  label?: string;
  lx?: number;
  ly?: number;
  marker: string;
  color?: string;
}) {
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        markerEnd={`url(#${marker})`}
      />
      {label ? (
        <text x={lx} y={ly} fontSize={11} fill={MUTED} textAnchor="middle">
          {label}
        </text>
      ) : null}
    </g>
  );
}

const STEPS = ["Turn 1", "Action", "Action", "Turn 2", "Action"];

/**
 * The mechanism in one picture and six plain paragraphs that carry the same
 * facts: page and MCP server, the Workflow, the Screen sandbox with the Guard
 * in front of HARBOURMASTER, the model that sees only the picture, the Code
 * sandbox off to the side, and the checks that read the Books.
 */
export function HowItWorks() {
  const id = useId().replace(/:/g, "");
  const arrow = `${id}-arrow`;
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="outline-box flex flex-col gap-4 rounded-sm bg-paper p-4"
    >
      <div>
        <p className="eyebrow text-[0.65rem] text-ink-muted">How it works</p>
        <h2 id={`${id}-heading`} className="text-lg font-semibold">
          One agent, one Guard, and code that decides
        </h2>
      </div>

      <div className="overflow-x-auto rounded-sm border-2 border-ink/15 bg-marble">
        <svg
          viewBox="0 0 880 540"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="block h-auto w-full min-w-[40rem]"
        >
          <title id={titleId}>How a Run of the Operator works</title>
          <desc id={descId}>
            Your page and outside clients reach one MCP server. A Workflow runs
            a step per Turn and per Action, and can wait for a person. The model
            on the AI Gateway sees only the picture of the Screen. In the Screen
            sandbox, headless Chromium sends each key to the Guard, which passes
            it to HARBOURMASTER or stops it. The Code sandbox has no route to
            the Screen sandbox. After the Run, the checks read the Books and
            return Findings and a Verdict.
          </desc>
          <defs>
            <marker
              id={arrow}
              viewBox="0 0 10 10"
              refX={9}
              refY={5}
              markerWidth={7}
              markerHeight={7}
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill={BLUE} />
            </marker>
          </defs>

          {/* Who asks */}
          <Box
            x={20}
            y={20}
            w={200}
            h={56}
            title="Your page"
            line="watch, approve, stop"
          />
          <Box
            x={320}
            y={20}
            w={240}
            h={56}
            title="MCP server"
            line="/api/operator/mcp"
            fill={"var(--color-morning-haze)"}
          />
          <Box
            x={660}
            y={20}
            w={200}
            h={56}
            title="Outside client"
            line="Claude, by token"
          />
          <Arrow d="M224,48 L314,48" marker={arrow} />
          <Arrow d="M656,48 L566,48" marker={arrow} />
          <Arrow d="M440,80 L440,118" marker={arrow} />

          {/* The Workflow */}
          <rect
            x={20}
            y={124}
            width={580}
            height={110}
            rx={2}
            fill={PAPER}
            stroke={INK}
            strokeWidth={2}
          />
          <text
            x={34}
            y={146}
            fontFamily="var(--font-mono)"
            fontSize={13}
            fontWeight={700}
            fill={INK}
          >
            WORKFLOW
          </text>
          <text x={126} y={146} fontSize={11} fill={MUTED}>
            a durable step per Turn and per Action
          </text>
          {STEPS.map((step, index) => (
            <g key={`${step}-${index.toString()}`}>
              <rect
                x={34 + index * 84}
                y={164}
                width={74}
                height={30}
                rx={2}
                fill={step.startsWith("Turn") ? INK : MARBLE}
                stroke={INK}
                strokeWidth={2}
              />
              <text
                x={71 + index * 84}
                y={184}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize={11}
                fill={step.startsWith("Turn") ? PAPER : INK}
              >
                {step}
              </text>
            </g>
          ))}
          <rect
            x={460}
            y={160}
            width={126}
            height={38}
            rx={2}
            fill={BRASS}
            stroke={INK}
            strokeWidth={2}
          />
          <text
            x={523}
            y={177}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize={11}
            fontWeight={700}
            fill={INK}
          >
            HOOK
          </text>
          <text x={523} y={191} textAnchor="middle" fontSize={10} fill={INK}>
            waits for a person
          </text>
          <text x={34} y={222} fontSize={11} fill={MUTED}>
            A paused Action holds the Run here until someone approves or
            refuses.
          </text>

          {/* The model */}
          <Box
            x={660}
            y={140}
            w={200}
            h={78}
            title="Model, AI Gateway"
            line="sees only the picture"
          />
          <Arrow
            d="M604,166 L654,166"
            marker={arrow}
            label="Frame"
            lx={629}
            ly={158}
          />
          <Arrow
            d="M656,196 L606,196"
            marker={arrow}
            label="Actions"
            lx={631}
            ly={212}
          />

          {/* The Screen sandbox */}
          <rect
            x={20}
            y={270}
            width={580}
            height={170}
            rx={2}
            fill={MARBLE}
            stroke={INK}
            strokeWidth={2}
            strokeDasharray="7 5"
          />
          <text
            x={34}
            y={292}
            fontFamily="var(--font-mono)"
            fontSize={13}
            fontWeight={700}
            fill={INK}
          >
            SCREEN SANDBOX
          </text>
          <text x={176} y={292} fontSize={11} fill={MUTED}>
            Vercel Sandbox, no network
          </text>
          <Arrow d="M300,238 L300,300" marker={arrow} />
          <Box
            x={40}
            y={312}
            w={150}
            h={56}
            title="Chromium"
            line="headless, shows it"
          />
          <Box
            x={230}
            y={312}
            w={140}
            h={56}
            title="Guard"
            line="tries the key on a copy"
            fill={"var(--color-morning-haze)"}
          />
          <Box
            x={410}
            y={312}
            w={170}
            h={56}
            title="HARBOURMASTER"
            line="80 by 24, no API"
            fill={GREEN_SCREEN}
            dark
          />
          <Arrow d="M194,340 L224,340" marker={arrow} />
          <Arrow d="M374,340 L404,340" marker={arrow} />
          <text x={300} y={392} textAnchor="middle" fontSize={11} fill={RED}>
            allow, refuse or pause
          </text>
          <Box x={430} y={386} w={130} h={40} title="Books" />

          {/* The Code sandbox, off to the side */}
          <rect
            x={660}
            y={300}
            width={200}
            height={110}
            rx={2}
            fill={PAPER}
            stroke={INK}
            strokeWidth={2}
            strokeDasharray="7 5"
          />
          <text
            x={760}
            y={330}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize={13}
            fontWeight={700}
            fill={INK}
          >
            CODE SANDBOX
          </text>
          <text x={760} y={350} textAnchor="middle" fontSize={11} fill={MUTED}>
            run_code, no network
          </text>
          <text x={760} y={368} textAnchor="middle" fontSize={11} fill={MUTED}>
            parse, check, diff
          </text>
          <line
            x1={604}
            y1={355}
            x2={656}
            y2={355}
            stroke={RED}
            strokeWidth={2}
            strokeDasharray="4 4"
          />
          <path
            d="M622,345 L638,365 M638,345 L622,365"
            stroke={RED}
            strokeWidth={2.5}
          />
          <text x={630} y={384} textAnchor="middle" fontSize={10} fill={RED}>
            no route
          </text>

          {/* The checks */}
          <Box
            x={300}
            y={470}
            w={300}
            h={50}
            title="Checks (code)"
            line="read the Books: Findings, Verdict"
            fill={"var(--color-morning-haze)"}
          />
          <Arrow d="M495,430 L495,464" marker={arrow} />
        </svg>
      </div>

      <div className="grid max-w-4xl gap-3 text-sm leading-relaxed md:grid-cols-2">
        <p>
          <strong>What the model sees.</strong> The Operator is a vision model
          on the AI Gateway. Each Turn it gets a picture of the Screen, the Task
          and the Rules as text, and answers with Actions: clicks, typing, key
          presses. It never sees the Books, has no API to HARBOURMASTER and
          cannot tell whether a key will be allowed.
        </p>
        <p>
          <strong>What the Guard does with each key.</strong> Before
          HARBOURMASTER takes a key, the Guard runs it on a copy first and looks
          at what would change: the Screen it lands on and the records it
          commits. Then it applies the Rules. It lets the key through, refuses
          it, or pauses the Run until a person approves.
        </p>
        <p>
          <strong>Why only code gives a Verdict.</strong> When the driver says
          it is done, its summary decides nothing. Code compares the Books
          before and after with what the Task asked and with the Rules, and
          returns Findings. The Verdict is correct, incorrect, or unverified
          when there was nothing to compare with.
        </p>
        <p>
          <strong>Why two sandboxes.</strong> The Screen sandbox holds
          HARBOURMASTER, the headless browser and the Guard. The Code sandbox is
          where run_code parses a Manifest or checks container numbers. Neither
          has a network, and code cannot reach the Screen, so nothing gets into
          the Books except through the Guard.
        </p>
        <p>
          <strong>The caps.</strong> One Run gets at most {LIMITS.turnsPerRun}{" "}
          Turns, {LIMITS.actionsPerRun} Actions, ${LIMITS.usdPerRun.toFixed(2)}{" "}
          of model spend, {LIMITS.codeRunsPerRun} code runs and{" "}
          {LIMITS.sandboxMinutes} minutes of Screen sandbox. A pause waits{" "}
          {LIMITS.approvalWaitMinutes} minutes, then the Action is refused. The
          harness enforces them, never the model.
        </p>
        <p>
          <strong>Where this applies in banking.</strong> Core-banking green
          screens, payment repair queues and back-office systems that only take
          a keyboard. The same Guard keeps the agent to the Screens and records
          it is allowed, and a person still signs off the keys that move money
          or release a hold.
        </p>
      </div>
    </section>
  );
}
