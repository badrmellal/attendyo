"use client";

/**
 * AskBar — the dashboard "Ask" surface (`POST /api/ask`). A deterministic,
 * on-prem intent parser answers natural questions over people / departments /
 * zones / attendance — NO LLM, no cloud. The bar renders the answer inline as a
 * titled table or text; unknown questions come back with clickable suggestions.
 *
 * All chrome is white-label + localized (fr/en/ar). The placeholder reads
 * "Demandez à {product_name}…" from branding, never a hard-coded brand.
 */

import { useState } from "react";
import { Loader2, Search, Sparkles } from "lucide-react";
import { useBranding } from "./BrandingProvider";
import { ask } from "@/lib/api";
import type { AskResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Example prompts — localized, and phrased so the parser understands them. */
const EXAMPLE_KEYS = ["ask.ex.late", "ask.ex.zone", "ask.ex.overtime", "ask.ex.onsite"] as const;

export function AskBar({ className }: { className?: string }) {
  const { branding, t } = useBranding();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const run = async (q: string) => {
    const question = q.trim();
    if (!question || loading) return;
    setQuery(question);
    setLoading(true);
    setError(false);
    try {
      setResult(await ask(question));
    } catch {
      setError(true);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cn("card p-5", className)}>
      {/* Heading */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-display font-semibold text-text">
            {t("ask.placeholder", { product: branding.product_name }).replace(/…$/, "")}
          </h3>
          <p className="text-xs text-text-muted">{t("iq.subtitle")}</p>
        </div>
        <Sparkles className="h-4 w-4 text-accent" />
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
        className="flex items-center gap-2"
      >
        <label htmlFor="ask-input" className="sr-only">
          {t("ask.placeholder", { product: branding.product_name })}
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-text-muted" />
          <input
            id="ask-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("ask.placeholder", { product: branding.product_name })}
            className="field w-full py-2.5 ps-10 pe-3 text-sm"
            autoComplete="off"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="btn-primary inline-flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span className="hidden sm:inline">{t("ask.submit")}</span>
        </button>
      </form>

      {/* Example chips — shown until there's a result to make room for it */}
      {!result && !loading && !error && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">{t("ask.examples")}</span>
          {EXAMPLE_KEYS.map((key) => {
            const text = t(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => run(text)}
                className="rounded-full border border-border bg-surface-2/40 px-3 py-1 text-xs text-text-muted transition-colors hover:border-primary/40 hover:text-text"
              >
                {text}
              </button>
            );
          })}
        </div>
      )}

      {/* Answer */}
      {loading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("ask.thinking")}
        </div>
      )}

      {error && !loading && (
        <p className="mt-4 text-sm text-danger">{t("ask.error")}</p>
      )}

      {result && !loading && (
        <AskAnswer result={result} onSuggestion={run} />
      )}
    </div>
  );
}

function AskAnswer({
  result,
  onSuggestion,
}: {
  result: AskResult;
  onSuggestion: (q: string) => void;
}) {
  const hasTable = !!(result.columns && result.rows && result.rows.length > 0);
  // A column is treated as numeric (tabular, end-aligned) when every cell is a number.
  const numericCol =
    hasTable && result.columns
      ? result.columns.map((_, ci) => result.rows!.every((r) => typeof r[ci] === "number"))
      : [];

  return (
    <div className="mt-4 animate-fade-in">
      <h4 className="mb-2 font-display text-sm font-semibold text-text">{result.title}</h4>

      {hasTable ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2/50">
                  {result.columns!.map((col, ci) => (
                    <th
                      key={ci}
                      className={cn(
                        "border-b border-border px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-muted",
                        numericCol[ci] ? "text-end" : "text-start",
                      )}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows!.map((row, ri) => (
                  <tr key={ri} className="border-b border-border/50 last:border-b-0 hover:bg-surface-2/30">
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          "px-3.5 py-2.5 text-text",
                          numericCol[ci] ? "tnum text-end" : "text-start",
                          ci === 0 && "font-medium",
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : result.text ? (
        <p className="text-sm text-text-muted">{result.text}</p>
      ) : null}

      {result.suggestions && result.suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {result.suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSuggestion(s)}
              className="rounded-full border border-border bg-surface-2/40 px-3 py-1 text-xs text-text-muted transition-colors hover:border-primary/40 hover:text-text"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
