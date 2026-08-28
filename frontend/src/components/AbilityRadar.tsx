import type { PortraitAxis } from "../types";

function point(index: number, value: number, cx: number, cy: number, radius: number, count: number): [number, number] {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  const r = radius * (value / 100);
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function polygon(values: number[], cx: number, cy: number, radius: number): string {
  return values.map((v, i) => point(i, v, cx, cy, radius, values.length).join(",")).join(" ");
}

export default function AbilityRadar({
  axes,
  compare,
}: {
  axes: PortraitAxis[];
  compare?: boolean;
}) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 92;
  const rings = [25, 50, 75, 100];
  const labels = axes.map((a) => a.label);
  const values = axes.map((a) => (a.sufficient && typeof a.accuracy_rate === "number" ? a.accuracy_rate * 100 : 0));
  const classValues = compare
    ? axes.map((a) => (typeof a.class_accuracy_rate === "number" ? a.class_accuracy_rate * 100 : 0))
    : null;
  const n = axes.length;
  if (!n) return null;

  return (
    <div className="portrait-radar">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <title>题型正确率能力模型</title>
        {rings.map((pct) => (
          <polygon
            key={pct}
            fill="none"
            stroke="#ece8f4"
            strokeWidth={1}
            points={polygon(Array(n).fill(pct), cx, cy, radius)}
          />
        ))}
        {labels.map((_, i) => {
          const [x, y] = point(i, 100, cx, cy, radius, n);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#ece8f4" strokeWidth={1} />;
        })}
        {classValues ? (
          <polygon
            points={polygon(classValues, cx, cy, radius)}
            fill="#f6f3fb"
            stroke="#8a829c"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        ) : null}
        <polygon
          points={polygon(values, cx, cy, radius)}
          fill="rgba(91, 63, 212, 0.18)"
          stroke="#5b3fd4"
          strokeWidth={2}
        />
        {labels.map((label, i) => {
          const [x, y] = point(i, 118, cx, cy, radius, n);
          return (
            <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#5c5670" fontSize={12}>
              {label}
            </text>
          );
        })}
      </svg>
      <p className="portrait-radar-caption">
        近全部作答正确率
        {compare ? " · 虚线为班级均值" : ""}
        。作答不足 5 次的能力记为 0，右侧表会标「数据不足」。
      </p>
    </div>
  );
}
