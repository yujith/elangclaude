"use client";

// Renders Question.visual specs (parsed via apps/web/lib/writing/visual.ts).
// Brand-faithful: only red, black, and the grey scale. Recharts powers
// bar/line/pie; tables and process diagrams use semantic HTML/SVG.
//
// Accessibility: every chart also emits a screen-reader-only <table>
// with the same data so non-sighted users can review the figures the
// task is asking about.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  BarVisual,
  LineVisual,
  PieVisual,
  ProcessVisual,
  TableVisual,
  Visual,
} from "@/lib/writing/visual";

// Brand-only palette. First series red, second black, then descending
// greys. We never introduce a new accent for charts — per brand.md.
const SERIES_COLORS = [
  "#EE2346", // brand red
  "#0A0A0A", // brand black
  "#737373", // brand grey 500
  "#A3A3A3", // brand grey 400
  "#404040", // brand grey 700
];

export function TaskVisual({ visual }: { visual: Visual }) {
  switch (visual.kind) {
    case "bar":
      return <BarVisualView v={visual} />;
    case "line":
      return <LineVisualView v={visual} />;
    case "pie":
      return <PieVisualView v={visual} />;
    case "table":
      return <TableVisualView v={visual} />;
    case "process":
      return <ProcessVisualView v={visual} />;
  }
}

function VisualShell({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="rounded-md bg-brand-grey-50 ring-1 ring-brand-grey-200 p-4">
      {title ? (
        <figcaption className="font-heading font-bold text-sm text-brand-grey-700 mb-3">
          {title}
        </figcaption>
      ) : null}
      {children}
    </figure>
  );
}

// ─── Bar ────────────────────────────────────────────────────────────────

function BarVisualView({ v }: { v: BarVisual }) {
  const data = v.categories.map((cat, i) => {
    const row: Record<string, string | number> = { category: cat };
    for (const s of v.series) row[s.name] = s.values[i] ?? 0;
    return row;
  });
  return (
    <VisualShell title={v.title}>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
            <XAxis
              dataKey="category"
              tick={{ fontSize: 12, fill: "#404040" }}
              stroke="#A3A3A3"
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#404040" }}
              stroke="#A3A3A3"
              label={
                v.unit
                  ? {
                      value: v.unit,
                      angle: -90,
                      position: "insideLeft",
                      style: { fill: "#737373", fontSize: 12 },
                    }
                  : undefined
              }
            />
            <Tooltip
              cursor={{ fill: "rgba(238, 35, 70, 0.06)" }}
              contentStyle={{
                background: "#0A0A0A",
                border: "none",
                borderRadius: 8,
                color: "#fff",
                fontFamily: "var(--font-body)",
              }}
              labelStyle={{ color: "#A3A3A3" }}
              formatter={(value: number) =>
                v.unit ? `${value}${v.unit}` : value
              }
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: "#404040" }}
              iconType="circle"
            />
            {v.series.map((s, i) => (
              <Bar
                key={s.name}
                dataKey={s.name}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <SrDataTable
        headers={["", ...v.series.map((s) => s.name)]}
        rows={v.categories.map((cat, i) => [
          cat,
          ...v.series.map((s) =>
            v.unit ? `${s.values[i] ?? ""}${v.unit}` : String(s.values[i] ?? ""),
          ),
        ])}
      />
    </VisualShell>
  );
}

// ─── Line ───────────────────────────────────────────────────────────────

function LineVisualView({ v }: { v: LineVisual }) {
  const data = v.x_values.map((x, i) => {
    const row: Record<string, string | number> = { x };
    for (const s of v.series) row[s.name] = s.values[i] ?? 0;
    return row;
  });
  return (
    <VisualShell title={v.title}>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
            <XAxis
              dataKey="x"
              tick={{ fontSize: 12, fill: "#404040" }}
              stroke="#A3A3A3"
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#404040" }}
              stroke="#A3A3A3"
              label={
                v.unit
                  ? {
                      value: v.unit,
                      angle: -90,
                      position: "insideLeft",
                      style: { fill: "#737373", fontSize: 12 },
                    }
                  : undefined
              }
            />
            <Tooltip
              contentStyle={{
                background: "#0A0A0A",
                border: "none",
                borderRadius: 8,
                color: "#fff",
              }}
              labelStyle={{ color: "#A3A3A3" }}
              formatter={(value: number) =>
                v.unit ? `${value}${v.unit}` : value
              }
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: "#404040" }}
              iconType="circle"
            />
            {v.series.map((s, i) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <SrDataTable
        headers={["", ...v.series.map((s) => s.name)]}
        rows={v.x_values.map((x, i) => [
          x,
          ...v.series.map((s) =>
            v.unit ? `${s.values[i] ?? ""}${v.unit}` : String(s.values[i] ?? ""),
          ),
        ])}
      />
    </VisualShell>
  );
}

// ─── Pie ────────────────────────────────────────────────────────────────

function PieVisualView({ v }: { v: PieVisual }) {
  const data = v.slices.map((s) => ({ name: s.label, value: s.value }));
  return (
    <VisualShell title={v.title}>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={90}
              label={(entry: { name: string }) => entry.name}
              labelLine={{ stroke: "#A3A3A3" }}
              isAnimationActive={false}
            >
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "#0A0A0A",
                border: "none",
                borderRadius: 8,
                color: "#fff",
              }}
              labelStyle={{ color: "#A3A3A3" }}
              formatter={(value: number) =>
                v.unit ? `${value}${v.unit}` : value
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <SrDataTable
        headers={["Segment", "Value"]}
        rows={v.slices.map((s) => [
          s.label,
          v.unit ? `${s.value}${v.unit}` : String(s.value),
        ])}
      />
    </VisualShell>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────

function TableVisualView({ v }: { v: TableVisual }) {
  return (
    <VisualShell title={v.title}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-body text-brand-grey-900">
          <thead>
            <tr className="text-left">
              {v.headers.map((h, i) => (
                <th
                  key={i}
                  scope="col"
                  className="px-3 py-2 font-heading font-bold text-brand-grey-700 border-b border-brand-grey-200"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.rows.map((row, ri) => (
              <tr key={ri} className="even:bg-brand-white">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={
                      "px-3 py-2 border-b border-brand-grey-100 " +
                      (ci === 0 ? "font-heading font-bold text-brand-black" : "")
                    }
                  >
                    {String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </VisualShell>
  );
}

// ─── Process ────────────────────────────────────────────────────────────

function ProcessVisualView({ v }: { v: ProcessVisual }) {
  return (
    <VisualShell title={v.title}>
      <ol className="flex flex-col md:flex-row md:flex-wrap gap-3 items-stretch">
        {v.steps.map((step, i) => (
          <li
            key={i}
            className="flex-1 min-w-[140px] flex md:flex-col items-start md:items-stretch gap-3"
          >
            <div className="flex md:flex-col items-center gap-2 md:gap-3">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-brand-red text-white font-heading font-bold text-sm shrink-0">
                {i + 1}
              </span>
              {i < v.steps.length - 1 ? (
                <ArrowGlyph className="hidden md:block text-brand-grey-400" />
              ) : null}
            </div>
            <div className="flex-1 rounded-md bg-brand-white ring-1 ring-brand-grey-200 p-3">
              <p className="font-heading font-bold text-sm text-brand-black">
                {step.label}
              </p>
              {step.detail ? (
                <p className="mt-1 font-body text-xs text-brand-grey-700 leading-snug">
                  {step.detail}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </VisualShell>
  );
}

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

// ─── A11y data table ────────────────────────────────────────────────────

function SrDataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <table className="sr-only">
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, ci) => (
              <td key={ci}>{String(c)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
