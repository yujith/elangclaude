// Typed shape for the optional `Question.visual` Json column.
//
// The DB stores arbitrary JSON; this module owns the parser + the
// rendering contract. If a row has an unknown `kind` or is missing
// required fields, `parseVisual` returns null and the UI silently
// renders just the prompt text — no broken charts.
//
// All chart visuals carry a `data` shape Recharts can map directly:
//   bar/line  → rows of { category/x, [seriesName]: value, ... }
//   pie       → rows of { label, value }
//
// Adding a new visual `kind` is intentional and gets a code change here
// + a renderer in components/task-visual.tsx.

export type BarVisual = {
  kind: "bar";
  title?: string;
  x_label?: string;
  y_label?: string;
  unit?: string;
  categories: string[];
  series: { name: string; values: number[] }[];
};

export type LineVisual = {
  kind: "line";
  title?: string;
  x_label?: string;
  y_label?: string;
  unit?: string;
  x_values: string[];
  series: { name: string; values: number[] }[];
};

export type PieVisual = {
  kind: "pie";
  title?: string;
  unit?: string;
  slices: { label: string; value: number }[];
};

export type TableVisual = {
  kind: "table";
  title?: string;
  headers: string[];
  rows: (string | number)[][];
};

export type ProcessVisual = {
  kind: "process";
  title?: string;
  steps: { label: string; detail?: string }[];
};

export type Visual =
  | BarVisual
  | LineVisual
  | PieVisual
  | TableVisual
  | ProcessVisual;

// ─── Parser ──────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x): x is string => typeof x === "string")) return null;
  return v;
}

function asNumberArray(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x): x is number => typeof x === "number" && Number.isFinite(x))) {
    return null;
  }
  return v;
}

function asSeries(v: unknown): { name: string; values: number[] }[] | null {
  if (!Array.isArray(v)) return null;
  const out: { name: string; values: number[] }[] = [];
  for (const raw of v) {
    if (!isObject(raw)) return null;
    if (typeof raw.name !== "string") return null;
    const values = asNumberArray(raw.values);
    if (!values) return null;
    out.push({ name: raw.name, values });
  }
  return out;
}

export function parseVisual(raw: unknown): Visual | null {
  if (!isObject(raw)) return null;
  const kind = raw.kind;
  switch (kind) {
    case "bar": {
      const categories = asStringArray(raw.categories);
      const series = asSeries(raw.series);
      if (!categories || !series) return null;
      return {
        kind: "bar",
        title: stringOrUndef(raw.title),
        x_label: stringOrUndef(raw.x_label),
        y_label: stringOrUndef(raw.y_label),
        unit: stringOrUndef(raw.unit),
        categories,
        series,
      };
    }
    case "line": {
      const x_values = asStringArray(raw.x_values);
      const series = asSeries(raw.series);
      if (!x_values || !series) return null;
      return {
        kind: "line",
        title: stringOrUndef(raw.title),
        x_label: stringOrUndef(raw.x_label),
        y_label: stringOrUndef(raw.y_label),
        unit: stringOrUndef(raw.unit),
        x_values,
        series,
      };
    }
    case "pie": {
      if (!Array.isArray(raw.slices)) return null;
      const slices: { label: string; value: number }[] = [];
      for (const s of raw.slices) {
        if (!isObject(s)) return null;
        if (typeof s.label !== "string") return null;
        if (typeof s.value !== "number" || !Number.isFinite(s.value)) return null;
        slices.push({ label: s.label, value: s.value });
      }
      return {
        kind: "pie",
        title: stringOrUndef(raw.title),
        unit: stringOrUndef(raw.unit),
        slices,
      };
    }
    case "table": {
      const headers = asStringArray(raw.headers);
      if (!headers) return null;
      if (!Array.isArray(raw.rows)) return null;
      const rows: (string | number)[][] = [];
      for (const r of raw.rows) {
        if (!Array.isArray(r)) return null;
        const row: (string | number)[] = [];
        for (const cell of r) {
          if (typeof cell !== "string" && typeof cell !== "number") return null;
          row.push(cell);
        }
        rows.push(row);
      }
      return { kind: "table", title: stringOrUndef(raw.title), headers, rows };
    }
    case "process": {
      if (!Array.isArray(raw.steps)) return null;
      const steps: { label: string; detail?: string }[] = [];
      for (const s of raw.steps) {
        if (!isObject(s)) return null;
        if (typeof s.label !== "string") return null;
        steps.push({
          label: s.label,
          detail: stringOrUndef(s.detail),
        });
      }
      return { kind: "process", title: stringOrUndef(raw.title), steps };
    }
    default:
      return null;
  }
}

function stringOrUndef(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
