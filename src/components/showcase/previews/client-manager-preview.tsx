import {
  BRANCHES,
  TONE_HEX,
} from "@/features/client-manager/domain/categories";

/**
 * Client Manager in miniature: the client at the centre, a hub per Branch
 * and their Nodes around it, while a walk lights a path from the client out
 * to one fact and back across the network.
 */
export function ClientManagerPreview() {
  const hubs = BRANCHES.map((branch, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / BRANCHES.length;
    return {
      id: branch.id,
      tone: TONE_HEX[branch.tone],
      angle,
      x: Math.cos(angle) * 105,
      y: Math.sin(angle) * 105,
    };
  });
  const nodes = hubs.flatMap((hub, hubIndex) =>
    Array.from({ length: 3 + (hubIndex % 3) }, (_, index) => {
      const spread = hub.angle + (index - 1.5) * 0.28;
      const radius = 150 + (index % 2) * 18;
      return {
        key: `${hub.id}-${index}`,
        tone: hub.tone,
        x: Math.cos(spread) * radius,
        y: Math.sin(spread) * radius,
      };
    }),
  );
  const walk = [hubs[1], nodes[5], hubs[3], nodes[13]].filter(Boolean) as {
    x: number;
    y: number;
  }[];
  const path = `M0,0 ${walk.map((point) => `L${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}`;
  return (
    <div className="relative aspect-[4/3] overflow-hidden bg-marble">
      <svg
        viewBox="-220 -165 440 330"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <circle
          r={105}
          fill="none"
          stroke="#14213d"
          strokeOpacity={0.15}
          strokeDasharray="2 6"
        />
        {hubs.map((hub) => (
          <line
            key={`s-${hub.id}`}
            x1={0}
            y1={0}
            x2={hub.x}
            y2={hub.y}
            stroke={hub.tone}
            strokeOpacity={0.45}
            strokeWidth={1.5}
          />
        ))}
        {nodes.map((node) => {
          const hub = hubs.find((item) => node.key.startsWith(item.id));
          return hub ? (
            <line
              key={`t-${node.key}`}
              x1={hub.x}
              y1={hub.y}
              x2={node.x}
              y2={node.y}
              stroke={node.tone}
              strokeOpacity={0.3}
            />
          ) : null;
        })}
        <path
          d={path}
          fill="none"
          stroke="#d9a84e"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray="1"
          className="motion-safe:animate-walk"
        />
        {nodes.map((node, index) => (
          <circle
            key={node.key}
            cx={node.x}
            cy={node.y}
            r={5.5}
            fill="#fff"
            stroke={node.tone}
            strokeWidth={2}
            className="motion-safe:animate-bloom"
            style={{ animationDelay: `${(index % 9) * 0.08}s` }}
          />
        ))}
        {hubs.map((hub) => (
          <g key={hub.id}>
            <circle
              cx={hub.x}
              cy={hub.y}
              r={15}
              fill={hub.tone}
              fillOpacity={0.2}
              stroke={hub.tone}
              strokeWidth={2.5}
            />
            <circle
              cx={hub.x}
              cy={hub.y}
              r={6}
              fill="#fff"
              stroke="#14213d"
              strokeWidth={1.5}
            />
          </g>
        ))}
        <circle r={24} fill="#fff" stroke="#14213d" strokeWidth={3} />
        <text
          y={6}
          textAnchor="middle"
          className="fill-federal-blue font-mono text-[16px] font-bold"
        >
          EM
        </text>
      </svg>
      <div className="absolute right-3 bottom-3 left-3 rounded-sm border-2 border-ink bg-paper px-3 py-2 font-mono text-[10px] leading-relaxed shadow-hard-sm sm:text-xs">
        <p>
          <span className="text-ivy">●</span>{" "}
          <span className="font-bold">Expand</span>
          <span className="text-ink-muted">(Ivy, 2 hops)</span>
        </p>
        <p className="text-ink-muted">
          ⎿ pgr_drivingDistance · reached 9 nodes
        </p>
      </div>
    </div>
  );
}
