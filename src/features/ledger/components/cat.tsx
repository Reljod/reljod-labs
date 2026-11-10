import "./ledger.css";

export type CatPose =
  | "idle"
  | "wave"
  | "think"
  | "search"
  | "talk"
  | "run"
  | "run-down"
  | "run-up"
  | "fly"
  | "found"
  | "confused"
  | "sleep"
  | "carry"
  | "push"
  | "toss"
  | "stamp"
  | "conduct"
  | "unstitch";

type PoseConfig = {
  view: "front" | "side" | "down" | "up" | "fly";
  arms?: string[];
  eyes?: string;
  mouth?: string;
  ex?: number;
  ey?: number;
  tilt?: number;
  extra?: string[];
};

const POSES: Record<CatPose, PoseConfig> = {
  idle: {
    view: "front",
    arms: ["armLdown", "armRdown"],
    eyes: "eyesOpen",
    mouth: "mSmile",
  },
  wave: {
    view: "front",
    arms: ["armLdown", "armRwave"],
    eyes: "eyesOpen",
    mouth: "mOpen",
  },
  think: {
    view: "front",
    arms: ["armRdown", "armLthink"],
    eyes: "eyesOpen",
    mouth: "mFlat",
    ex: -2,
    ey: -4,
    tilt: 4,
    extra: ["dots"],
  },
  search: {
    view: "front",
    arms: ["book"],
    eyes: "eyesOpen",
    mouth: "mFlat",
    ey: 4,
    tilt: -3,
  },
  talk: {
    view: "front",
    arms: ["armLdown", "armRdown"],
    eyes: "eyesOpen",
    mouth: "mOpen",
    tilt: 2,
  },
  run: { view: "side", extra: ["speed"] },
  "run-down": { view: "down" },
  "run-up": { view: "up" },
  fly: { view: "fly", extra: ["speed"] },
  found: {
    view: "front",
    arms: ["armsUp"],
    eyes: "eyesHappy",
    mouth: "mOpen",
    extra: ["spark"],
  },
  confused: {
    view: "front",
    arms: ["armLdown", "armRscratch"],
    eyes: "eyesOpen",
    mouth: "mO",
    ex: -2,
    tilt: -8,
    extra: ["qmark"],
  },
  sleep: {
    view: "front",
    arms: ["armLdown", "armRdown"],
    eyes: "eyesClosed",
    mouth: "mFlat",
    tilt: 5,
    extra: ["zzz"],
  },
  carry: {
    view: "front",
    arms: ["armsUp"],
    eyes: "eyesOpen",
    mouth: "mOpen",
    ey: -4,
  },
  push: {
    view: "front",
    arms: ["armsForward"],
    eyes: "eyesOpen",
    mouth: "mFlat",
    ex: 3,
    tilt: -10,
  },
  toss: {
    view: "front",
    arms: ["armLdown", "armRthrow"],
    eyes: "eyesOpen",
    mouth: "mOpen",
    ex: 3,
    tilt: 5,
  },
  stamp: {
    view: "front",
    arms: ["armLdown", "stamp"],
    eyes: "eyesOpen",
    mouth: "mSmile",
    ex: 2,
    ey: 4,
  },
  conduct: {
    view: "front",
    arms: ["armLdown", "pen"],
    eyes: "eyesOpen",
    mouth: "mOpen",
    ey: -3,
    tilt: 3,
    extra: ["spark"],
  },
  unstitch: {
    view: "front",
    arms: ["thread"],
    eyes: "eyesOpen",
    mouth: "mFlat",
    ex: -3,
    tilt: -8,
  },
};

const PARTS = [
  "front",
  "side",
  "down",
  "up",
  "fly",
  "armLdown",
  "armRdown",
  "armsUp",
  "armRwave",
  "armRscratch",
  "armLthink",
  "book",
  "armsForward",
  "armRthrow",
  "stamp",
  "pen",
  "thread",
  "eyesOpen",
  "eyesHappy",
  "eyesClosed",
  "mSmile",
  "mOpen",
  "mFlat",
  "mO",
  "dots",
  "qmark",
  "zzz",
  "spark",
  "speed",
] as const;

type CatProps = {
  pose?: CatPose;
  /** Mirrors him to face left. */
  flip?: boolean;
  /** Degrees, for flying along a diagonal. */
  rot?: number;
  /** Width in px; height follows the 240×250 artwork. */
  size?: number;
  animate?: boolean;
};

/** Ledger, the cat banker: one SVG whose pose swaps arms, eyes, mouth and view. */
export function Cat({
  pose = "idle",
  flip = false,
  rot = 0,
  size = 240,
  animate = true,
}: CatProps) {
  const cfg = POSES[pose];
  const on = new Set<string>([
    cfg.view,
    ...(cfg.arms ?? []),
    cfg.eyes ?? "",
    cfg.mouth ?? "",
    ...(cfg.extra ?? []),
  ]);
  const v = Object.fromEntries(
    PARTS.map((part) => [part, on.has(part) ? "inline" : "none"]),
  ) as Record<(typeof PARTS)[number], string>;
  const shadowRx = cfg.view === "fly" ? 34 : cfg.view === "side" ? 72 : 52;
  const shadowCx = cfg.view === "side" ? (flip ? 108 : 132) : 120;
  const flipT = flip ? "translate(240 0) scale(-1 1)" : "translate(0 0)";
  const rotT = `rotate(${rot} 120 125)`;

  return (
    <svg
      className={`lgr ${animate ? "lgr-anim" : "lgr-still"} pose-${pose}`}
      viewBox="0 0 240 250"
      width={size}
      height={Math.round((size * 250) / 240)}
      role="img"
      aria-label={`Ledger the cat banker, ${pose} pose`}
      data-pose={pose}
    >
      <ellipse
        cx={shadowCx}
        cy="229"
        rx={shadowRx}
        ry="6"
        fill="#14213D"
        opacity="0.12"
      />

      <g transform={flipT}>
        <g transform={rotT}>
          <g display={v.speed}>
            <g className="c-speed">
              <path className="speed" d="M2 112 L30 112" />
              <path className="speed" d="M0 146 L26 146" />
              <path className="speed" d="M6 180 L32 180" />
            </g>
          </g>

          <g className="c-runner">
            <g className="c-breathe">
              <g display={v.front}>
                <g className="c-tail">
                  <path
                    className="tail"
                    d="M152 200 C 188 204, 202 176, 192 150 C 187 138, 198 130, 205 139"
                  />
                  <path
                    className="tailtip"
                    d="M195 145 C 192 137, 199 131, 205 139"
                  />
                </g>
                <rect
                  x="94"
                  y="196"
                  width="18"
                  height="20"
                  rx="6"
                  fill="#14213D"
                />
                <ellipse cx="100" cy="220" rx="15" ry="7.5" fill="#2B1D16" />
                <ellipse
                  cx="95"
                  cy="217"
                  rx="5"
                  ry="2"
                  fill="#FFFFFF"
                  opacity="0.35"
                />
                <rect
                  x="128"
                  y="196"
                  width="18"
                  height="20"
                  rx="6"
                  fill="#14213D"
                />
                <ellipse cx="140" cy="220" rx="15" ry="7.5" fill="#2B1D16" />
                <ellipse
                  cx="135"
                  cy="217"
                  rx="5"
                  ry="2"
                  fill="#FFFFFF"
                  opacity="0.35"
                />

                <g display={v.armLdown}>
                  <path className="sleeve" d="M88 150 Q80 172 80 188" />
                  <circle cx="80" cy="194" r="9.5" className="paw" />
                </g>
                <g display={v.armRdown}>
                  <path className="sleeve" d="M152 150 Q160 172 160 188" />
                  <circle cx="160" cy="194" r="9.5" className="paw" />
                </g>

                <path
                  d="M82 144 Q120 132 158 144 L164 200 Q120 212 76 200 Z"
                  fill="#14213D"
                />
                <path d="M106 140 L120 172 L134 140 Z" fill="#FFFFFF" />
                <path
                  d="M111 152 L120 172 L129 152 L129 188 L111 188 Z"
                  fill="#22335A"
                />
                <path className="lapel" d="M105 141 L118 174" />
                <path className="lapel" d="M135 141 L122 174" />
                <path
                  d="M116 139 L124 139 L122 146 L118 146 Z"
                  fill="#163E6E"
                />
                <path
                  d="M118 145 L122 145 L125 165 L120 172 L115 165 Z"
                  fill="#1D4E89"
                />
                <circle cx="120" cy="181" r="2.8" fill="#C9A227" />
                <circle cx="120" cy="192" r="2.8" fill="#C9A227" />
                <path
                  d="M90 158 L104 158 L101 151 L97 155 L93 150 Z"
                  fill="#C9A227"
                />
                <path d="M88 159 L106 159" stroke="#2D4270" strokeWidth="2" />
                <path className="chain" d="M126 186 Q140 196 152 184" />
                <circle cx="153" cy="183" r="3.2" fill="#C9A227" />

                <g display={v.armsUp}>
                  <path className="sleeve" d="M88 148 Q68 124 64 100" />
                  <circle cx="63" cy="93" r="10" className="paw" />
                  <path className="sleeve" d="M152 148 Q172 124 176 100" />
                  <circle cx="177" cy="93" r="10" className="paw" />
                </g>
                <g display={v.armRwave}>
                  <g className="c-wave">
                    <path className="sleeve" d="M152 150 Q176 134 184 108" />
                    <circle cx="186" cy="100" r="10.5" className="paw" />
                  </g>
                </g>
                <g display={v.armRscratch}>
                  <path className="sleeve" d="M152 148 Q190 124 172 66" />
                  <circle cx="170" cy="58" r="10" className="paw" />
                </g>

                <g display={v.armsForward}>
                  <g className="c-tug">
                    <path className="sleeve" d="M88 152 Q132 166 196 154" />
                    <path className="sleeve" d="M152 152 Q182 160 200 166" />
                    <circle cx="202" cy="153" r="10" className="paw" />
                    <circle cx="205" cy="167" r="10" className="paw" />
                  </g>
                </g>
                <g display={v.armRthrow}>
                  <g className="c-throw">
                    <path className="sleeve" d="M152 150 Q184 122 190 88" />
                    <circle cx="191" cy="80" r="10.5" className="paw" />
                  </g>
                </g>
                <g display={v.stamp}>
                  <g className="c-stamp">
                    <path className="sleeve" d="M152 150 Q178 158 186 176" />
                    <rect
                      x="180"
                      y="166"
                      width="13"
                      height="18"
                      rx="4"
                      fill="#6B4226"
                    />
                    <rect
                      x="170"
                      y="184"
                      width="33"
                      height="11"
                      rx="2"
                      fill="#C9A227"
                      stroke="#14213D"
                      strokeWidth="2"
                    />
                    <circle cx="186" cy="172" r="9.5" className="paw" />
                  </g>
                </g>
                <g display={v.pen}>
                  <g className="c-conduct">
                    <path className="sleeve" d="M152 150 Q182 130 188 100" />
                    <g transform="rotate(-28 196 86)">
                      <rect
                        x="191"
                        y="46"
                        width="10"
                        height="44"
                        rx="4"
                        fill="#C9A227"
                        stroke="#14213D"
                        strokeWidth="2"
                      />
                      <path d="M192 47 L200 47 L196 36 Z" fill="#14213D" />
                    </g>
                    <circle cx="189" cy="94" r="10" className="paw" />
                  </g>
                </g>
                <g display={v.thread}>
                  <g className="c-yank">
                    <path
                      className="c-thread"
                      d="M64 174 L-80 170"
                      fill="none"
                      stroke="#C9A227"
                      strokeWidth="3"
                      strokeDasharray="9 6"
                      strokeLinecap="round"
                    />
                    <path className="sleeve" d="M88 150 Q72 166 64 172" />
                    <path className="sleeve" d="M152 152 Q112 178 76 178" />
                    <circle cx="62" cy="172" r="10" className="paw" />
                    <circle cx="72" cy="179" r="10" className="paw" />
                  </g>
                </g>

                <g transform={`rotate(${cfg.tilt ?? 0} 120 140)`}>
                  <path d="M68 74 L62 22 L108 52 Z" fill="#E9A055" />
                  <path d="M75 66 L71 36 L99 54 Z" fill="#F2B8A8" />
                  <path d="M172 74 L178 22 L132 52 Z" fill="#E9A055" />
                  <path d="M165 66 L169 36 L141 54 Z" fill="#F2B8A8" />
                  <ellipse cx="120" cy="92" rx="66" ry="56" fill="#E9A055" />
                  <path className="stripe" d="M120 40 L120 54" />
                  <path className="stripe" d="M106 42 L109 54" />
                  <path className="stripe" d="M134 42 L131 54" />
                  <path className="stripe" d="M56 98 L67 100" />
                  <path className="stripe" d="M58 110 L68 109" />
                  <path className="stripe" d="M184 98 L173 100" />
                  <path className="stripe" d="M182 110 L172 109" />
                  <ellipse cx="120" cy="125" rx="23" ry="15" fill="#FBEBD3" />
                  <ellipse
                    cx="74"
                    cy="120"
                    rx="9"
                    ry="5"
                    fill="#EE8E7E"
                    opacity="0.55"
                  />
                  <ellipse
                    cx="166"
                    cy="120"
                    rx="9"
                    ry="5"
                    fill="#EE8E7E"
                    opacity="0.55"
                  />
                  <path
                    className="whisk"
                    d="M99 123 L62 116 M99 129 L62 131 M141 123 L178 116 M141 129 L178 131"
                  />

                  <g display={v.eyesOpen}>
                    <g className="c-blink">
                      <g className="c-scan">
                        <g
                          transform={`translate(${cfg.ex ?? 0} ${cfg.ey ?? 0})`}
                        >
                          <ellipse
                            cx="94"
                            cy="94"
                            rx="11.5"
                            ry="14"
                            fill="#14213D"
                          />
                          <ellipse
                            cx="94"
                            cy="97"
                            rx="7.5"
                            ry="9"
                            fill="#24477A"
                          />
                          <circle cx="98.5" cy="88" r="4.4" fill="#FFFFFF" />
                          <circle cx="89.5" cy="101" r="2" fill="#FFFFFF" />
                          <ellipse
                            cx="146"
                            cy="94"
                            rx="11.5"
                            ry="14"
                            fill="#14213D"
                          />
                          <ellipse
                            cx="146"
                            cy="97"
                            rx="7.5"
                            ry="9"
                            fill="#24477A"
                          />
                          <circle cx="150.5" cy="88" r="4.4" fill="#FFFFFF" />
                          <circle cx="141.5" cy="101" r="2" fill="#FFFFFF" />
                        </g>
                      </g>
                    </g>
                  </g>
                  <g display={v.eyesHappy}>
                    <path
                      className="ln"
                      d="M83 100 Q94 84 105 100 M135 100 Q146 84 157 100"
                      style={{ strokeWidth: 4 }}
                    />
                  </g>
                  <g display={v.eyesClosed}>
                    <path
                      className="ln"
                      d="M83 95 Q94 104 105 95 M135 95 Q146 104 157 95"
                      style={{ strokeWidth: 4 }}
                    />
                  </g>

                  <circle className="frame" cx="94" cy="94" r="23" />
                  <circle className="frame" cx="146" cy="94" r="23" />
                  <path
                    className="temple"
                    d="M117 92 Q120 86 123 92 M71 90 L56 82 M169 90 L184 82"
                  />
                  <path className="glint" d="M79 87 Q82 79 90 76" />
                  <path className="glint" d="M131 87 Q134 79 142 76" />

                  <path
                    d="M114 116 Q120 113 126 116 Q123 121 120 122 Q117 121 114 116 Z"
                    fill="#D9727A"
                  />
                  <g display={v.mSmile}>
                    <path
                      className="ln"
                      d="M120 122 L120 125 Q114 132 108 127 M120 125 Q126 132 132 127"
                    />
                  </g>
                  <g display={v.mOpen}>
                    <g className="c-mouth">
                      <path
                        d="M112 126 Q120 141 128 126 Z"
                        fill="#7A2E3A"
                        stroke="#14213D"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M115 134 Q120 130 125 134 Q120 138 115 134 Z"
                        fill="#EE8E7E"
                      />
                    </g>
                  </g>
                  <g display={v.mFlat}>
                    <path
                      className="ln"
                      d="M120 122 L120 126 M114 129 Q120 126 126 129"
                    />
                  </g>
                  <g display={v.mO}>
                    <path className="ln" d="M120 122 L120 125" />
                    <ellipse
                      cx="120"
                      cy="131"
                      rx="4"
                      ry="5"
                      fill="#7A2E3A"
                      stroke="#14213D"
                      strokeWidth="2"
                    />
                  </g>
                </g>

                <g display={v.armLthink}>
                  <path className="sleeve" d="M88 152 Q66 170 98 148" />
                  <circle cx="104" cy="144" r="10" className="paw" />
                </g>

                <g display={v.book}>
                  <path className="sleeve" d="M88 150 Q82 170 96 178" />
                  <path className="sleeve" d="M152 150 Q158 170 144 178" />
                  <g className="c-book">
                    <rect
                      x="90"
                      y="156"
                      width="60"
                      height="38"
                      rx="3"
                      fill="#2F5D3A"
                    />
                    <rect x="90" y="156" width="7" height="38" fill="#22462B" />
                    <rect
                      x="103"
                      y="163"
                      width="40"
                      height="4"
                      rx="2"
                      fill="#C9A227"
                    />
                    <rect
                      x="103"
                      y="171"
                      width="28"
                      height="3"
                      rx="1.5"
                      fill="#C9A227"
                      opacity="0.6"
                    />
                    <rect
                      x="103"
                      y="178"
                      width="34"
                      height="3"
                      rx="1.5"
                      fill="#C9A227"
                      opacity="0.6"
                    />
                  </g>
                  <circle cx="96" cy="181" r="9.5" className="paw" />
                  <circle cx="144" cy="181" r="9.5" className="paw" />
                </g>
              </g>

              <g display={v.side}>
                <g className="c-gdust1">
                  <circle cx="70" cy="220" r="9" fill="#E6DCC6" />
                </g>
                <g className="c-gdust2">
                  <circle cx="58" cy="214" r="7" fill="#E6DCC6" />
                </g>
                <g className="c-gdust3">
                  <circle cx="80" cy="224" r="6" fill="#E6DCC6" />
                </g>
                <g className="c-gbob">
                  <g className="c-ghind-f">
                    <path className="sleeve-far" d="M96 170 L96 204" />
                    <ellipse cx="100" cy="211" rx="11" ry="6" fill="#1E140F" />
                  </g>
                  <g className="c-gfore-f">
                    <path className="sleeve-far" d="M146 170 L146 202" />
                    <circle cx="147" cy="208" r="8.5" fill="#E6CFAE" />
                  </g>
                  <g className="c-gtail">
                    <path
                      className="tail"
                      d="M66 156 C 40 150, 28 128, 16 122"
                    />
                    <path
                      className="tailtip"
                      d="M28 128 C 24 125, 20 123, 16 122"
                    />
                  </g>
                  <g className="c-gcoat">
                    <path d="M70 166 L38 180 L68 186 Z" fill="#14213D" />
                  </g>
                  <g className="c-gtorso">
                    <path
                      d="M66 150 Q116 128 168 142 Q184 160 170 180 Q118 194 68 180 Q54 165 66 150 Z"
                      fill="#14213D"
                    />
                    <path className="lapel" d="M102 140 Q108 162 102 186" />
                    <path
                      d="M164 144 Q178 156 172 176 L164 174 Q168 158 158 148 Z"
                      fill="#FFFFFF"
                    />
                    <circle cx="122" cy="186" r="2.6" fill="#C9A227" />
                    <circle cx="138" cy="184" r="2.6" fill="#C9A227" />
                    <path
                      d="M120 150 L132 150 L130 144 L127 147 L124 143 Z"
                      fill="#C9A227"
                    />
                  </g>
                  <g className="c-gtie">
                    <path
                      d="M164 148 L170 153 L146 172 L140 166 Z"
                      fill="#1D4E89"
                    />
                  </g>
                  <g className="c-ghind-n">
                    <path className="sleeve" d="M84 170 L84 204" />
                    <ellipse cx="88" cy="212" rx="12" ry="6.5" fill="#2B1D16" />
                    <ellipse
                      cx="91"
                      cy="209"
                      rx="4"
                      ry="1.6"
                      fill="#FFFFFF"
                      opacity="0.35"
                    />
                  </g>
                  <g className="c-gfore-n">
                    <path className="sleeve" d="M158 170 L158 202" />
                    <circle cx="159" cy="209" r="9" className="paw" />
                  </g>
                  <g className="c-ghead">
                    <path d="M182 70 L198 32 L208 74 Z" fill="#D88E44" />
                    <path d="M150 82 L148 40 L178 68 Z" fill="#E9A055" />
                    <path d="M155 76 L154 52 L172 68 Z" fill="#F2B8A8" />
                    <ellipse cx="180" cy="108" rx="46" ry="42" fill="#E9A055" />
                    <path className="stripe" d="M140 98 L152 100" />
                    <path className="stripe" d="M142 112 L154 111" />
                    <path className="stripe" d="M162 70 L165 82" />
                    <ellipse
                      cx="213"
                      cy="122"
                      rx="18"
                      ry="12.5"
                      fill="#FBEBD3"
                    />
                    <ellipse
                      cx="184"
                      cy="126"
                      rx="7"
                      ry="4"
                      fill="#EE8E7E"
                      opacity="0.55"
                    />
                    <path
                      className="whisk"
                      d="M218 120 L240 113 M218 126 L240 130"
                    />
                    <path
                      d="M224 112 Q232 111 232 116 Q229 120 224 118 Z"
                      fill="#D9727A"
                    />
                    <path
                      d="M210 128 Q219 141 228 128 Z"
                      fill="#7A2E3A"
                      stroke="#14213D"
                      strokeWidth="2.2"
                      strokeLinejoin="round"
                    />
                    <g className="c-gtongue">
                      <ellipse
                        cx="216"
                        cy="138"
                        rx="4"
                        ry="5.5"
                        fill="#EE8E7E"
                      />
                    </g>
                    <g className="c-blink-g">
                      <ellipse
                        cx="198"
                        cy="102"
                        rx="9.5"
                        ry="13"
                        fill="#14213D"
                      />
                      <ellipse cx="199" cy="105" rx="6" ry="8" fill="#24477A" />
                      <circle cx="202" cy="96" r="4" fill="#FFFFFF" />
                      <circle cx="195" cy="109" r="1.8" fill="#FFFFFF" />
                    </g>
                    <circle className="frame" cx="198" cy="102" r="19" />
                    <path className="temple" d="M179 100 L150 93" />
                    <path className="glint" d="M186 95 Q189 88 195 86" />
                  </g>
                </g>
              </g>

              <g display={v.down}>
                <g className="c-dtail">
                  <path className="tail" d="M120 54 C 114 32, 130 16, 146 24" />
                  <path
                    className="tailtip"
                    d="M136 20 C 140 18, 144 20, 146 24"
                  />
                </g>
                <ellipse cx="120" cy="86" rx="58" ry="30" fill="#14213D" />
                <path d="M104 64 Q120 72 136 64" className="lapel" />
                <g className="c-dfoot-a">
                  <rect
                    x="92"
                    y="174"
                    width="18"
                    height="26"
                    rx="6"
                    fill="#14213D"
                  />
                  <ellipse cx="101" cy="206" rx="13" ry="11" fill="#2B1D16" />
                  <ellipse
                    cx="97"
                    cy="203"
                    rx="4"
                    ry="2"
                    fill="#FFFFFF"
                    opacity="0.35"
                  />
                </g>
                <g className="c-dfoot-b">
                  <rect
                    x="130"
                    y="174"
                    width="18"
                    height="26"
                    rx="6"
                    fill="#14213D"
                  />
                  <ellipse cx="139" cy="206" rx="13" ry="11" fill="#2B1D16" />
                  <ellipse
                    cx="135"
                    cy="203"
                    rx="4"
                    ry="2"
                    fill="#FFFFFF"
                    opacity="0.35"
                  />
                </g>
                <g className="c-darm-a">
                  <path className="sleeve" d="M72 98 Q60 122 62 140" />
                  <circle cx="62" cy="148" r="10" className="paw" />
                </g>
                <g className="c-darm-b">
                  <path className="sleeve" d="M168 98 Q180 122 178 140" />
                  <circle cx="178" cy="148" r="10" className="paw" />
                </g>
                <path d="M62 102 L54 48 L102 78 Z" fill="#E9A055" />
                <path d="M68 94 L63 60 L92 80 Z" fill="#F2B8A8" />
                <path d="M178 102 L186 48 L138 78 Z" fill="#E9A055" />
                <path d="M172 94 L177 60 L148 80 Z" fill="#F2B8A8" />
                <ellipse cx="120" cy="128" rx="70" ry="62" fill="#E9A055" />
                <path className="stripe" d="M120 70 L120 98" />
                <path className="stripe" d="M100 74 L105 98" />
                <path className="stripe" d="M140 74 L135 98" />
                <path className="stripe" d="M80 86 L88 100" />
                <path className="stripe" d="M160 86 L152 100" />
                <ellipse cx="120" cy="172" rx="22" ry="13" fill="#FBEBD3" />
                <ellipse
                  cx="72"
                  cy="164"
                  rx="9"
                  ry="5"
                  fill="#EE8E7E"
                  opacity="0.55"
                />
                <ellipse
                  cx="168"
                  cy="164"
                  rx="9"
                  ry="5"
                  fill="#EE8E7E"
                  opacity="0.55"
                />
                <path
                  className="whisk"
                  d="M99 170 L64 164 M99 176 L64 179 M141 170 L176 164 M141 176 L176 179"
                />
                <ellipse cx="96" cy="142" rx="11" ry="13" fill="#14213D" />
                <ellipse cx="96" cy="146" rx="7" ry="8" fill="#24477A" />
                <circle cx="100" cy="137" r="4" fill="#FFFFFF" />
                <ellipse cx="144" cy="142" rx="11" ry="13" fill="#14213D" />
                <ellipse cx="144" cy="146" rx="7" ry="8" fill="#24477A" />
                <circle cx="148" cy="137" r="4" fill="#FFFFFF" />
                <circle className="frame" cx="96" cy="142" r="21" />
                <circle className="frame" cx="144" cy="142" r="21" />
                <path
                  className="temple"
                  d="M117 140 Q120 134 123 140 M75 138 L57 130 M165 138 L183 130"
                />
                <path
                  d="M114 163 Q120 160 126 163 Q123 168 120 169 Q117 168 114 163 Z"
                  fill="#D9727A"
                />
                <path
                  d="M113 173 Q120 185 127 173 Z"
                  fill="#7A2E3A"
                  stroke="#14213D"
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                />
              </g>

              <g display={v.up}>
                <g className="c-ufoot-a">
                  <rect
                    x="94"
                    y="188"
                    width="18"
                    height="22"
                    rx="6"
                    fill="#14213D"
                  />
                  <ellipse cx="103" cy="214" rx="12" ry="8" fill="#8A6A50" />
                  <rect
                    x="96"
                    y="214"
                    width="14"
                    height="6"
                    rx="2"
                    fill="#5B4332"
                  />
                </g>
                <g className="c-ufoot-b">
                  <rect
                    x="128"
                    y="188"
                    width="18"
                    height="22"
                    rx="6"
                    fill="#14213D"
                  />
                  <ellipse cx="137" cy="214" rx="12" ry="8" fill="#8A6A50" />
                  <rect
                    x="130"
                    y="214"
                    width="14"
                    height="6"
                    rx="2"
                    fill="#5B4332"
                  />
                </g>
                <g className="c-uarm-a">
                  <path className="sleeve" d="M88 148 Q80 168 82 182" />
                  <circle cx="82" cy="188" r="9" className="paw" />
                </g>
                <g className="c-uarm-b">
                  <path className="sleeve" d="M152 148 Q160 168 158 182" />
                  <circle cx="158" cy="188" r="9" className="paw" />
                </g>
                <path
                  d="M82 140 Q120 128 158 140 L164 200 Q120 212 76 200 Z"
                  fill="#14213D"
                />
                <path className="lapel" d="M120 146 L120 206" />
                <path d="M100 186 L140 186" stroke="#2D4270" strokeWidth="3" />
                <circle cx="102" cy="186" r="2.6" fill="#C9A227" />
                <circle cx="138" cy="186" r="2.6" fill="#C9A227" />
                <g className="c-utail">
                  <path
                    className="tail"
                    d="M120 194 C 152 196, 176 168, 166 140 C 162 128, 172 120, 180 128"
                  />
                  <path
                    className="tailtip"
                    d="M170 132 C 170 124, 176 122, 180 128"
                  />
                </g>
                <path d="M68 74 L62 20 L108 50 Z" fill="#E9A055" />
                <path d="M75 66 L71 36 L97 52 Z" fill="#D88E44" />
                <path d="M172 74 L178 20 L132 50 Z" fill="#E9A055" />
                <path d="M165 66 L169 36 L143 52 Z" fill="#D88E44" />
                <ellipse cx="120" cy="90" rx="66" ry="56" fill="#E9A055" />
                <path className="stripe" d="M120 40 L120 74" />
                <path className="stripe" d="M102 44 L106 72" />
                <path className="stripe" d="M138 44 L134 72" />
                <path className="stripe" d="M80 60 L90 80" />
                <path className="stripe" d="M160 60 L150 80" />
                <path className="stripe" d="M96 92 L104 112" />
                <path className="stripe" d="M144 92 L136 112" />
                <path
                  className="temple"
                  d="M52 88 L66 92 M188 88 L174 92"
                  style={{ strokeWidth: 4 }}
                />
                <path
                  className="whisk"
                  d="M58 112 L40 108 M60 120 L40 123 M182 112 L200 108 M180 120 L200 123"
                />
              </g>

              <g display={v.fly}>
                <g className="c-ft1">
                  <path
                    d="M22 96 L24 102 L30 104 L24 106 L22 112 L20 106 L14 104 L20 102 Z"
                    fill="#C9A227"
                  />
                </g>
                <g className="c-ft2">
                  <path
                    d="M30 170 L32 175 L37 177 L32 179 L30 184 L28 179 L23 177 L28 175 Z"
                    fill="#C9A227"
                  />
                </g>
                <g className="c-ft3">
                  <path
                    d="M12 134 L13.5 138 L17.5 139.5 L13.5 141 L12 145 L10.5 141 L6.5 139.5 L10.5 138 Z"
                    fill="#1D4E89"
                  />
                </g>
                <g className="c-cape">
                  <path
                    d="M132 118 Q84 104 26 112 Q44 128 20 142 Q54 146 40 166 Q86 160 130 150 Z"
                    fill="#1D4E89"
                  />
                  <path
                    d="M26 112 Q44 128 20 142 Q54 146 40 166"
                    fill="none"
                    stroke="#C9A227"
                    strokeWidth="3"
                    strokeLinejoin="round"
                  />
                </g>
                <g className="c-flegs">
                  <rect
                    x="56"
                    y="148"
                    width="48"
                    height="14"
                    rx="7"
                    fill="#0B1428"
                  />
                  <ellipse cx="54" cy="155" rx="9" ry="9" fill="#1E140F" />
                  <rect
                    x="52"
                    y="132"
                    width="52"
                    height="15"
                    rx="7"
                    fill="#14213D"
                  />
                  <ellipse cx="50" cy="140" rx="9" ry="10" fill="#2B1D16" />
                </g>
                <path
                  d="M98 124 Q140 112 170 124 L172 158 Q136 168 98 158 Z"
                  fill="#14213D"
                />
                <g className="c-ftie">
                  <path
                    d="M164 132 L158 137 L124 141 L128 147 L160 143 Z"
                    fill="#1D4E89"
                  />
                </g>
                <path className="sleeve" d="M132 152 Q114 160 100 160" />
                <circle cx="96" cy="160" r="8.5" className="paw" />
                <path className="sleeve" d="M154 124 Q186 92 222 52" />
                <circle cx="228" cy="46" r="11" className="paw" />
                <path
                  className="ln"
                  d="M224 40 L226 44 M230 39 L231 43"
                  style={{ strokeWidth: 1.6 }}
                />
                <path d="M146 84 L140 46 L172 68 Z" fill="#E9A055" />
                <path d="M150 78 L146 54 L166 68 Z" fill="#F2B8A8" />
                <path d="M194 70 L204 34 L218 72 Z" fill="#E9A055" />
                <path d="M199 66 L204 46 L212 68 Z" fill="#F2B8A8" />
                <ellipse cx="182" cy="104" rx="46" ry="40" fill="#E9A055" />
                <path className="stripe" d="M182 66 L182 78" />
                <path className="stripe" d="M170 68 L172 80" />
                <ellipse cx="190" cy="127" rx="16" ry="10" fill="#FBEBD3" />
                <ellipse
                  cx="156"
                  cy="124"
                  rx="6"
                  ry="3.5"
                  fill="#EE8E7E"
                  opacity="0.55"
                />
                <ellipse cx="168" cy="104" rx="8.5" ry="10.5" fill="#14213D" />
                <circle cx="171" cy="99" r="3.2" fill="#FFFFFF" />
                <ellipse cx="204" cy="102" rx="8.5" ry="10.5" fill="#14213D" />
                <circle cx="207" cy="97" r="3.2" fill="#FFFFFF" />
                <circle className="frame" cx="168" cy="104" r="17" />
                <circle className="frame" cx="204" cy="102" r="17" />
                <path
                  className="temple"
                  d="M185 102 Q186 98 187 102 M151 102 L140 98"
                />
                <path
                  d="M186 119 Q190 117 194 119 Q192 123 190 123 Q188 123 186 119 Z"
                  fill="#D9727A"
                />
                <path
                  className="ln"
                  d="M190 123 L190 126 Q185 131 180 127 M190 126 Q195 131 200 127"
                />
              </g>
            </g>
          </g>
        </g>
      </g>

      <g display={v.dots}>
        <circle className="c-dot1" cx="184" cy="44" r="4.5" fill="#1D4E89" />
        <circle className="c-dot2" cx="198" cy="31" r="5.5" fill="#1D4E89" />
        <circle className="c-dot3" cx="214" cy="17" r="6.5" fill="#1D4E89" />
      </g>
      <g display={v.qmark}>
        <g className="c-q">
          <text className="mono" x="194" y="54" fontSize="42" fill="#1D4E89">
            ?
          </text>
        </g>
      </g>
      <g display={v.zzz}>
        <g className="c-z1">
          <text className="mono" x="176" y="52" fontSize="18" fill="#1D4E89">
            z
          </text>
        </g>
        <g className="c-z2">
          <text className="mono" x="192" y="34" fontSize="26" fill="#1D4E89">
            Z
          </text>
        </g>
      </g>
      <g display={v.spark}>
        <g className="c-spark">
          <path
            d="M34 58 L37 67 L46 70 L37 73 L34 82 L31 73 L22 70 L31 67 Z"
            fill="#C9A227"
          />
          <path
            d="M206 46 L208 53 L215 55 L208 57 L206 64 L204 57 L197 55 L204 53 Z"
            fill="#C9A227"
          />
          <path
            d="M216 104 L218 109 L223 111 L218 113 L216 118 L214 113 L209 111 L214 109 Z"
            fill="#1D4E89"
          />
          <path
            d="M22 114 L24 119 L29 121 L24 123 L22 128 L20 123 L15 121 L20 119 Z"
            fill="#1D4E89"
          />
        </g>
      </g>
    </svg>
  );
}
