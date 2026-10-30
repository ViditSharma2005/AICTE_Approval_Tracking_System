/**
 * Dependency-free SVG/HTML chart primitives.
 * They render on the server, so every dashboard paints on first byte
 * (no client JS, no chart library to break mid-demo).
 */

import { cn } from "./ui";

export type Datum = { label: string; value: number; color?: string };

const PALETTE = ["#4F46E5", "#0EA5E9", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6", "#14B8A6"];
export function palette(i: number) {
  return PALETTE[i % PALETTE.length];
}

// ---------------------------------------------------------------------------
// Vertical bars
// ---------------------------------------------------------------------------

export function VBarChart({
  data,
  height = 180,
  suffix = "",
}: {
  data: Datum[];
  height?: number;
  suffix?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="w-full">
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((d, i) => (
          <div key={d.label} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
            <span className="text-[11px] font-semibold text-ink tnum">{d.value}</span>
            <div
              className="w-full rounded-t-md transition-all group-hover:opacity-80"
              style={{
                height: `${Math.max(3, (d.value / max) * (height - 34))}px`,
                background: d.color ?? palette(i),
              }}
              title={`${d.label}: ${d.value}${suffix}`}
            />
            <span className="w-full truncate text-center text-[10px] leading-tight text-ink-faint">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bars (workload, region comparison)
// ---------------------------------------------------------------------------

export function HBarChart({
  data,
  suffix = "",
  emptyHint = "Nothing to plot yet.",
}: {
  data: Datum[];
  suffix?: string;
  emptyHint?: string;
}) {
  if (!data.length) return <p className="py-6 text-center text-xs text-ink-faint">{emptyHint}</p>;
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-xs font-medium text-ink-soft" title={d.label}>
            {d.label}
          </span>
          <div className="h-5 flex-1 overflow-hidden rounded-md bg-slate-100">
            <div
              className="flex h-full items-center justify-end rounded-md pr-1.5 text-[10px] font-semibold text-white tnum"
              style={{
                width: `${Math.max(2, (d.value / max) * 100)}%`,
                background: d.color ?? palette(i),
              }}
            >
              {d.value > 0 ? d.value : ""}
            </div>
          </div>
          <span className="w-14 shrink-0 text-right text-[11px] text-ink-faint tnum">
            {d.value}
            {suffix}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stacked ageing bars: one row per stage, segments per ageing bucket
// ---------------------------------------------------------------------------

export function StackedBarChart({
  rows,
  segments,
}: {
  rows: { label: string; values: Record<string, number> }[];
  segments: { key: string; label: string; color: string }[];
}) {
  const totals = rows.map((r) => segments.reduce((s, seg) => s + (r.values[seg.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const grand = totals.reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-ink-soft">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-ink-faint tnum">Total: {grand}</span>
      </div>

      {rows.map((row, i) => {
        const total = totals[i];
        return (
          <div key={row.label} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-xs font-medium text-ink-soft" title={row.label}>
              {row.label}
            </span>
            <div className="flex h-6 flex-1 overflow-hidden rounded-md bg-slate-100">
              {total === 0 ? null : (
                <>
                  {segments.map((seg) => {
                    const v = row.values[seg.key] ?? 0;
                    if (!v) return null;
                    const w = (v / max) * 100;
                    return (
                      <div
                        key={seg.key}
                        className="flex h-full items-center justify-center text-[10px] font-semibold text-white tnum"
                        style={{ width: `${w}%`, background: seg.color }}
                        title={`${row.label} · ${seg.label}: ${v}`}
                      >
                        {w > 7 ? v : ""}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
            <span className="w-10 shrink-0 text-right text-[11px] font-semibold text-ink tnum">{total}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donut
// ---------------------------------------------------------------------------

export function DonutChart({
  data,
  size = 168,
  centerLabel,
  centerValue,
}: {
  data: Datum[];
  size?: number;
  centerLabel?: string;
  centerValue?: string | number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = size / 2 - 12;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#EEF2F7" strokeWidth="18" />
          {total > 0 &&
            data.map((d, i) => {
              const len = (d.value / total) * circumference;
              const el = (
                <circle
                  key={d.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={d.color ?? palette(i)}
                  strokeWidth="18"
                  strokeDasharray={`${len} ${circumference - len}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })}
        </g>
        {centerValue !== undefined ? (
          <>
            <text
              x="50%"
              y={size / 2 - 2}
              textAnchor="middle"
              className="fill-ink text-xl font-bold tnum"
              style={{ fontSize: 22 }}
            >
              {centerValue}
            </text>
            <text x="50%" y={size / 2 + 16} textAnchor="middle" style={{ fontSize: 10 }} className="fill-[#8A99B0]">
              {centerLabel}
            </text>
          </>
        ) : null}
      </svg>

      <ul className="min-w-[130px] flex-1 space-y-1.5">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color ?? palette(i) }} />
            <span className="flex-1 truncate text-ink-soft">{d.label}</span>
            <span className="font-semibold text-ink tnum">{d.value}</span>
            {total > 0 ? (
              <span className="w-9 text-right text-ink-faint tnum">{Math.round((d.value / total) * 100)}%</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heat map: rows x columns, colour intensity by value
// ---------------------------------------------------------------------------

export function Heatmap({
  rows,
  cols,
  values,
  max,
}: {
  rows: string[];
  cols: string[];
  values: number[][];
  max?: number;
}) {
  const m = max ?? Math.max(1, ...values.flat());

  return (
    <div className="table-wrap">
      <table className="w-full min-w-[420px] border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="w-28" />
            {cols.map((c) => (
              <th key={c} className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r}>
              <td className="pr-2 text-right text-[11px] font-medium text-ink-soft">{r}</td>
              {cols.map((c, ci) => {
                const v = values[ri]?.[ci] ?? 0;
                const intensity = v === 0 ? 0 : Math.min(1, 0.18 + (v / m) * 0.82);
                return (
                  <td key={c}>
                    <div
                      className={cn(
                        "flex h-9 items-center justify-center rounded-md text-[11px] font-semibold tnum",
                        v === 0 ? "text-slate-300" : v / m > 0.6 ? "text-white" : "text-ink",
                      )}
                      style={{ background: v === 0 ? "#F8FAFC" : `rgba(239, 68, 68, ${intensity})` }}
                      title={`${r} · ${c}: ${v}`}
                    >
                      {v}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend line (submissions vs decisions)
// ---------------------------------------------------------------------------

export function TrendChart({
  labels,
  series,
  height = 150,
}: {
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  height?: number;
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const w = 100;
  const h = 100;
  const step = labels.length > 1 ? w / (labels.length - 1) : w;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height }} className="w-full">
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" y1={h * g} x2={w} y2={h * g} stroke="#EEF2F7" strokeWidth="0.4" />
        ))}
        {series.map((s) => {
          const pts = s.values.map((v, i) => `${i * step},${h - (v / max) * (h - 6) - 3}`);
          return (
            <g key={s.name}>
              <polyline points={pts.join(" ")} fill="none" stroke={s.color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
              {s.values.map((v, i) => (
                <circle
                  key={i}
                  cx={i * step}
                  cy={h - (v / max) * (h - 6) - 3}
                  r="1.4"
                  fill={s.color}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5 text-[11px] text-ink-soft">
            <span className="h-2 w-4 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
        <div className="ml-auto flex gap-2 text-[10px] text-ink-faint">
          {labels.map((l, i) => (
            <span key={l + i} className="tnum">
              {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
