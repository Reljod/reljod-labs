import type { ReactNode } from "react";
import type { DiagramId } from "../../docs/types";

/*
 * The Docs' diagrams: inline SVG that takes its colours from the page
 * (`currentColor` and the `hx-dg-*` classes in harness.css), so they read in
 * the site's theme. Each has a title and a description for screen readers.
 */

type Tone = "plain" | "accent" | "person" | "stop";

type NodeProps = {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  tone?: Tone;
};

function Node({ x, y, w, h, label, sub, tone = "plain" }: NodeProps) {
  const cy = sub ? y + h / 2 - 6 : y + h / 2;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={3}
        className={`hx-dg-box hx-dg-${tone}`}
      />
      <text
        x={x + w / 2}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        className="hx-dg-text hx-dg-strong"
      >
        {label}
      </text>
      {sub ? (
        <text
          x={x + w / 2}
          y={y + h / 2 + 10}
          textAnchor="middle"
          dominantBaseline="central"
          className="hx-dg-text hx-dg-small"
        >
          {sub}
        </text>
      ) : null}
    </g>
  );
}

function Arrow({
  d,
  marker,
  dashed,
}: {
  d: string;
  marker: string;
  dashed?: boolean;
}) {
  return (
    <path
      d={d}
      className={`hx-dg-line${dashed ? " hx-dg-dashed" : ""}`}
      markerEnd={`url(#${marker})`}
    />
  );
}

function Note({
  x,
  y,
  children,
  anchor = "middle",
}: {
  x: number;
  y: number;
  children: ReactNode;
  anchor?: "start" | "middle" | "end";
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      dominantBaseline="central"
      className="hx-dg-text hx-dg-small"
    >
      {children}
    </text>
  );
}

function Frame({
  id,
  title,
  description,
  width,
  height,
  children,
}: {
  id: string;
  title: string;
  description: string;
  width: number;
  height: number;
  children: (marker: string) => ReactNode;
}) {
  const marker = `hx-dg-arrow-${id}`;
  return (
    <figure className="hx-dg-figure">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${marker}-title ${marker}-desc`}
        className="hx-dg"
      >
        <title id={`${marker}-title`}>{title}</title>
        <desc id={`${marker}-desc`}>{description}</desc>
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {children(marker)}
      </svg>
      <figcaption className="hx-dg-caption">{title}</figcaption>
    </figure>
  );
}

// Architecture ------------------------------------------------------------------

const BACKENDS: { label: string; sub: string }[] = [
  { label: "Pipelines", sub: "Runs on the Workflow SDK" },
  { label: "Knowledge base", sub: "Sources, Passages, search" },
  { label: "Records", sub: "Employers, Members, Schedules" },
  { label: "Skills and Rules", sub: "SKILL.md, Versions" },
  { label: "Audit trail", sub: "Append-only" },
  { label: "Sandbox", sub: "Runner, container on the VPS" },
];

function Architecture() {
  return (
    <Frame
      id="architecture"
      title="Architecture: Claude and the built-in chat reach everything through one MCP server"
      description="Two clients, Claude and the built-in chat Agent, call the Harness MCP server. The server calls Pipelines, the Knowledge base, records, Skills and Rules, the Audit trail and the Sandbox."
      width={720}
      height={380}
    >
      {(marker) => (
        <>
          <Node
            x={10}
            y={70}
            w={170}
            h={64}
            label="Claude"
            sub="Claude.ai, Code, Cowork"
          />
          <Node
            x={10}
            y={240}
            w={170}
            h={64}
            label="Built-in chat"
            sub="The Agent in a Session"
          />
          <Node
            x={250}
            y={150}
            w={170}
            h={80}
            label="Harness MCP server"
            sub="/api/harness/mcp"
            tone="accent"
          />
          <Arrow d="M180 102 H215 V170 H250" marker={marker} />
          <Note x={118} y={152} anchor="middle">
            OAuth 2.1 + PKCE
          </Note>
          <Arrow d="M180 272 H215 V210 H250" marker={marker} />
          <Note x={118} y={322} anchor="middle">
            in process, short-lived token
          </Note>
          {BACKENDS.map((item, index) => {
            const y = 10 + index * 60;
            return (
              <g key={item.label}>
                <Node
                  x={520}
                  y={y}
                  w={190}
                  h={50}
                  label={item.label}
                  sub={item.sub}
                />
                <Arrow d={`M420 190 H470 V${y + 25} H520`} marker={marker} />
              </g>
            );
          })}
        </>
      )}
    </Frame>
  );
}

// A Run's life ------------------------------------------------------------------

function RunLife() {
  return (
    <Frame
      id="run-life"
      title="A Run's life: levels of Steps, an Approval, and how it ends"
      description="A Run starts, runs level 1 Steps at the same time, then level 2, then waits at an Approval. A person approves and the Run completes, or returns it and the Run ends returned. A Run can also fail or be stopped."
      width={720}
      height={330}
    >
      {(marker) => (
        <>
          <Node x={10} y={125} w={90} h={50} label="Run starts" tone="accent" />
          <Arrow d="M100 150 H130" marker={marker} />
          <rect
            x={130}
            y={20}
            width={150}
            height={240}
            rx={4}
            className="hx-dg-lane"
          />
          <Note x={205} y={36}>
            Level 1: at the same time
          </Note>
          <Node x={145} y={58} w={120} h={46} label="Step A" sub="code" />
          <Node
            x={145}
            y={128}
            w={120}
            h={46}
            label="Step B"
            sub="model reads"
          />
          <Node x={145} y={198} w={120} h={46} label="Step C" sub="code" />
          <Arrow d="M280 150 H310" marker={marker} />
          <rect
            x={310}
            y={80}
            width={130}
            height={140}
            rx={4}
            className="hx-dg-lane"
          />
          <Note x={375} y={96}>
            Level 2
          </Note>
          <Node
            x={320}
            y={128}
            w={110}
            h={46}
            label="Step D"
            sub="waits for A, B, C"
          />
          <Arrow d="M440 150 H470" marker={marker} />
          <Node
            x={470}
            y={118}
            w={110}
            h={64}
            label="Approval"
            sub="waits for a person"
            tone="person"
          />
          <Arrow d="M580 135 H610 V70 H625" marker={marker} />
          <Note x={625} y={70} anchor="start">
            approved: completed
          </Note>
          <Arrow d="M580 165 H610 V230 H625" marker={marker} />
          <Note x={625} y={230} anchor="start">
            returned
          </Note>
          <Note x={360} y={286}>
            A Step that still fails after its retries ends the Run failed.
          </Note>
          <Note x={360} y={308}>
            A person can stop a Run at any time.
          </Note>
        </>
      )}
    </Frame>
  );
}

// Ingest and the Conflict check --------------------------------------------------

function Ingest() {
  return (
    <Frame
      id="ingest"
      title="Ingest: a new Source is split, embedded and checked for Conflicts"
      description="A Source is uploaded, split into Passages, embedded, and each new Passage is searched against the old ones. A model decides whether close matches state different values for the same fact. If not, the Source is ready. If so, a Conflict opens and an admin settles it."
      width={720}
      height={340}
    >
      {(marker) => (
        <>
          <Node
            x={10}
            y={20}
            w={120}
            h={50}
            label="Source added"
            sub="upload or chat"
          />
          <Arrow d="M130 45 H160" marker={marker} />
          <Node
            x={160}
            y={20}
            w={120}
            h={50}
            label="Split"
            sub="into Passages"
          />
          <Arrow d="M280 45 H310" marker={marker} />
          <Node
            x={310}
            y={20}
            w={120}
            h={50}
            label="Embed"
            sub="768 dimensions"
          />
          <Arrow d="M430 45 H460" marker={marker} />
          <Node
            x={460}
            y={20}
            w={250}
            h={50}
            label="Search the old Passages"
            sub="close matches only"
          />
          <Arrow d="M585 70 V110" marker={marker} />
          <Node
            x={460}
            y={110}
            w={250}
            h={56}
            label="Model: different values"
            sub="for the same fact?"
          />
          <Arrow d="M460 138 H300 V120 H260" marker={marker} />
          <Note x={380} y={150}>
            no
          </Note>
          <Node
            x={110}
            y={95}
            w={150}
            h={50}
            label="Source ready"
            sub="no Conflict"
            tone="accent"
          />
          <Arrow d="M585 166 V200" marker={marker} />
          <Note x={600} y={184} anchor="start">
            yes
          </Note>
          <Node
            x={460}
            y={200}
            w={250}
            h={50}
            label="Conflict opened"
            sub="both Passages stay retrievable"
            tone="stop"
          />
          <Arrow d="M585 250 V275" marker={marker} />
          <Node
            x={400}
            y={275}
            w={310}
            h={50}
            label="An admin settles it"
            sub="supersede, keep both or set aside"
            tone="person"
          />
        </>
      )}
    </Frame>
  );
}

// OAuth sign-in ------------------------------------------------------------------

const LANES = [
  { x: 80, label: "Claude" },
  { x: 260, label: "MCP server" },
  { x: 440, label: "OAuth endpoints" },
  { x: 630, label: "You (consent page)" },
] as const;

type Message = { n: number; from: number; to: number; y: number; text: string };

const MESSAGES: Message[] = [
  { n: 1, from: 0, to: 1, y: 85, text: "call with no token" },
  { n: 2, from: 1, to: 0, y: 115, text: "401, points to metadata" },
  { n: 3, from: 0, to: 2, y: 145, text: "read metadata" },
  { n: 4, from: 0, to: 2, y: 175, text: "register (POST)" },
  { n: 5, from: 0, to: 3, y: 205, text: "open consent, PKCE challenge" },
  { n: 6, from: 3, to: 3, y: 235, text: "choose Staff, allow" },
  { n: 7, from: 3, to: 0, y: 265, text: "back with a code" },
  { n: 8, from: 0, to: 2, y: 295, text: "code + verifier, get token" },
  { n: 9, from: 0, to: 1, y: 325, text: "call with the token" },
];

function OAuth() {
  return (
    <Frame
      id="oauth"
      title="OAuth sign-in: nine steps from first call to an authorised call"
      description="Claude calls the MCP server and gets a 401, reads the metadata, registers, sends you to the consent page with a PKCE challenge, you choose a Staff member and allow, Claude gets a code, trades it for a token and calls the server with it."
      width={720}
      height={360}
    >
      {(marker) => (
        <>
          {LANES.map((lane) => (
            <g key={lane.label}>
              <Node
                x={lane.x - 60}
                y={10}
                w={120}
                h={32}
                label={lane.label}
                tone="accent"
              />
              <line
                x1={lane.x}
                y1={42}
                x2={lane.x}
                y2={350}
                className="hx-dg-line hx-dg-dashed"
              />
            </g>
          ))}
          {MESSAGES.map((message) => {
            const from = LANES[message.from].x;
            const to = LANES[message.to].x;
            const self = message.from === message.to;
            const mid = (from + to) / 2;
            return (
              <g key={message.n}>
                {self ? (
                  <Arrow
                    d={`M${from} ${message.y - 8} H${from + 40} V${message.y + 8} H${from + 2}`}
                    marker={marker}
                  />
                ) : (
                  <Arrow
                    d={`M${from} ${message.y} H${to + (to > from ? -2 : 2)}`}
                    marker={marker}
                  />
                )}
                <Note
                  x={self ? from - 6 : mid}
                  y={message.y - 10}
                  anchor={self ? "end" : "middle"}
                >
                  {`${message.n}. ${message.text}`}
                </Note>
              </g>
            );
          })}
        </>
      )}
    </Frame>
  );
}

// Sandbox path ---------------------------------------------------------------------

function SandboxPath() {
  return (
    <Frame
      id="sandbox-path"
      title="The Sandbox path: Vercel, Caddy, the Runner, then a container"
      description="The app on Vercel signs a short-lived token and calls the Runner's address over HTTPS. Caddy on the VPS ends TLS and proxies to the Runner on the loopback address. The Runner drives Docker, and the code runs in a container with no network."
      width={720}
      height={230}
    >
      {(marker) => (
        <>
          <Node
            x={10}
            y={70}
            w={120}
            h={70}
            label="Vercel"
            sub="the app signs a token"
          />
          <Arrow d="M130 105 H175" marker={marker} />
          <Note x={152} y={90}>
            HTTPS
          </Note>
          <rect
            x={175}
            y={20}
            width={535}
            height={190}
            rx={5}
            className="hx-dg-lane"
          />
          <Note x={190} y={36} anchor="start">
            The VPS
          </Note>
          <Node x={190} y={70} w={110} h={70} label="Caddy" sub="ends TLS" />
          <Arrow d="M300 105 H335" marker={marker} />
          <Node
            x={335}
            y={70}
            w={130}
            h={70}
            label="Runner"
            sub="127.0.0.1 only"
            tone="accent"
          />
          <Arrow d="M465 105 H500" marker={marker} />
          <Note x={482} y={90}>
            docker
          </Note>
          <Node
            x={500}
            y={50}
            w={195}
            h={44}
            label="Container for Session A"
            sub="no network"
            tone="stop"
          />
          <Node
            x={500}
            y={114}
            w={195}
            h={44}
            label="Container for Session B"
            sub="no network"
            tone="stop"
          />
          <Note x={597} y={185}>
            Limits on CPU, memory, processes and time
          </Note>
        </>
      )}
    </Frame>
  );
}

const DIAGRAMS: Record<DiagramId, () => ReactNode> = {
  architecture: Architecture,
  "run-life": RunLife,
  ingest: Ingest,
  oauth: OAuth,
  "sandbox-path": SandboxPath,
};

export function Diagram({ id }: { id: DiagramId }) {
  const Draw = DIAGRAMS[id];
  return <Draw />;
}
