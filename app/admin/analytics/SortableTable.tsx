"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { isoDay, toCsv } from "@/lib/chart";

export type Column<T> = {
  key: string;
  label: string;
  /** What the column sorts by and exports: numbers sort as numbers, text alphabetically, missing values last. */
  value: (row: T) => string | number | null;
  /** How a cell shows; the value as it is when left out. */
  render?: (row: T) => ReactNode;
  numeric?: boolean;
  /** A longer explanation, on the header. */
  title?: string;
  className?: string;
  /** A cell's own class and style (the retention grid shades each cell by its share). */
  cell?: (row: T) => { className?: string; style?: CSSProperties };
};

type Sort = { key: string; dir: "asc" | "desc" };

/** Rows sorted by one column (missing values always last), as the table shows them. Exported for the tests. */
export function sortRows<T>(rows: readonly T[], columns: readonly Column<T>[], sort: Sort | null): T[] {
  const column = sort && columns.find((c) => c.key === sort.key);
  if (!column || !sort) return [...rows];
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const [va, vb] = [column.value(a), column.value(b)];
    if (va === null || va === "") return vb === null || vb === "" ? 0 : 1;
    if (vb === null || vb === "") return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * sign;
    return String(va).localeCompare(String(vb)) * sign;
  });
}

/** The table as CSV: the header row, then every row's values in column order. */
export function tableCsv<T>(rows: readonly T[], columns: readonly Column<T>[]): string {
  return toCsv([columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => c.value(r)))]);
}

/**
 * A table whose columns sort with a click (or Enter): the first click sorts numbers biggest first and text A to Z, the
 * next reverses it. "Download CSV" saves every row in the current order.
 */
export default function SortableTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  csvName,
  initialSort = null,
  empty = "Nothing in this period.",
  note,
  limit,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  csvName: string;
  initialSort?: Sort | null;
  empty?: ReactNode;
  note?: ReactNode;
  /** Show only the first rows (in the current order) until "Show all"; the download always has every row. */
  limit?: number;
}) {
  const [sort, setSort] = useState<Sort | null>(initialSort);
  const [all, setAll] = useState(false);
  const sorted = sortRows(rows, columns, sort);
  const shown = limit && !all ? sorted.slice(0, limit) : sorted;

  function sortBy(c: Column<T>) {
    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.numeric ? "desc" : "asc" }));
  }
  function download() {
    const blob = new Blob([tableCsv(sorted, columns)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `botchelor-${csvName}-${isoDay(new Date())}.csv`;
    // On the page for the click: some browsers ignore a click on a link that isn't.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <div className="table-tools">
        {note ? <p className="muted small">{note}</p> : <span />}
        {rows.length > 0 && (
          <button type="button" className="secondary small" onClick={download}>
            Download CSV
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <div className="table-scroll">
          <table className="board">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {columns.map((c) => {
                  const active = sort?.key === c.key;
                  return (
                    <th
                      key={c.key}
                      className={c.numeric ? "num" : undefined}
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
                      title={c.title}
                    >
                      <button type="button" className="sort-button" onClick={() => sortBy(c)}>
                        {c.label}
                        <span className="sort-mark" aria-hidden="true">
                          {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((c) => {
                    const own = c.cell?.(row);
                    const className = [c.numeric ? "num" : "", c.className ?? "", own?.className ?? ""].join(" ").trim();
                    return (
                      <td key={c.key} className={className || undefined} style={own?.style}>
                        {c.render ? c.render(row) : (c.value(row) ?? "—")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {limit !== undefined && rows.length > limit && (
        <button type="button" className="secondary small table-more" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? `Show the first ${limit}` : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}
