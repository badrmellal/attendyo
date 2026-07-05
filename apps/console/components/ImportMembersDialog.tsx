"use client";

/**
 * ImportMembersDialog — bulk-create members from a CSV file
 * (`POST /api/members/import`). Drag-and-drop or click to pick the file, a
 * format helper with a downloadable template (data: URI), then a result view
 * showing created / skipped counts and per-line errors. Members are created
 * WITHOUT photos — faces get enrolled later, one photo each.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Download,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";
import { Dialog } from "./Dialog";
import { FormError } from "./FormField";
import { IMPORT_CSV_COLUMNS, importMembersCSV } from "@/lib/api";
import type { ImportResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const TEMPLATE_ROWS = [
  IMPORT_CSV_COLUMNS.join(","),
  "Yasmine El Amrani,EMP-1042,employee,Finance,Comptable,y.elamrani@entreprise.ma,+212 612345678,,",
  "Adam Berrady,ETU-2201,student,Faculté des Sciences,,a.berrady@univ.ma,,2026-09-01,2027-06-30",
  "SOCLEAN Services,PRE-330,contractor,Prestataires,Nettoyage,,,2026-07-01,2026-12-31",
].join("\n");

const TEMPLATE_URI = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_ROWS)}`;

export function ImportMembersDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a successful import so the caller can refresh its list. */
  onImported: (result: ImportResult) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setDragOver(false);
      setSubmitting(false);
      setError(null);
      setResult(null);
    }
  }, [open]);

  const pick = useCallback((f: File | null) => {
    setError(null);
    setResult(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      setError("Choisissez un fichier .csv.");
      return;
    }
    setFile(f);
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    pick(e.dataTransfer.files?.[0] ?? null);
  }

  async function submit() {
    if (!file) {
      setError("Sélectionnez d'abord un fichier CSV.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await importMembersCSV(file);
      setResult(res);
      if (res.created > 0) onImported(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'import.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Importer un CSV"
      description="Crée les personnes en masse — les visages sont enregistrés ensuite, une photo chacun."
      size="md"
      footer={
        <>
          <button type="button" className="btn-ghost px-4 py-2 text-sm" onClick={onClose}>
            {result ? "Fermer" : "Annuler"}
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
            onClick={submit}
            disabled={submitting || !file || !!result}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            Importer
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "relative rounded-xl border-2 border-dashed transition-colors",
            dragOver ? "border-primary/60 bg-primary/[0.06]" : "border-border bg-surface-2/30",
          )}
        >
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 px-6 py-8 text-center">
            <UploadCloud className={cn("h-7 w-7", dragOver ? "text-primary" : "text-text-muted")} />
            {file ? (
              <span className="inline-flex items-center gap-2 text-sm font-medium text-text">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                {file.name}
                <button
                  type="button"
                  aria-label="Retirer le fichier"
                  onClick={(e) => {
                    e.preventDefault();
                    setFile(null);
                    setResult(null);
                  }}
                  className="rounded p-0.5 text-text-muted hover:text-danger"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <>
                <span className="text-sm font-medium text-text">
                  Déposez le fichier ici ou cliquez pour parcourir
                </span>
                <span className="text-xs text-text-muted">CSV · UTF-8 · en-tête requis</span>
              </>
            )}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {/* Format help */}
        <div className="rounded-lg border border-border bg-surface-2/30 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Format attendu
            </p>
            <a
              href={TEMPLATE_URI}
              download="import-personnes.csv"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <Download className="h-3.5 w-3.5" /> Télécharger le modèle
            </a>
          </div>
          <code className="tnum mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-bg/60 px-2.5 py-1.5 text-[11px] text-text-muted">
            {IMPORT_CSV_COLUMNS.join(",")}
          </code>
          <ul className="mt-2 space-y-0.5 text-xs text-text-muted">
            <li>· Seul <span className="font-medium text-text">full_name</span> est obligatoire.</li>
            <li>
              · <span className="font-medium text-text">member_type</span> : employee, resident,
              contractor, visitor, student, faculty, staff.
            </li>
            <li>
              · <span className="font-medium text-text">valid_from / valid_until</span> (AAAA-MM-JJ)
              — fenêtre d&apos;accès temporaire, optionnelle.
            </li>
            <li>· Les lignes dont l&apos;identifiant (external_id) existe déjà sont ignorées.</li>
          </ul>
        </div>

        {/* Result */}
        {result && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                <span className="tnum font-semibold">{result.created}</span> créée(s) ·{" "}
                <span className="tnum font-semibold">{result.skipped}</span> ignorée(s) ·{" "}
                <span className="tnum font-semibold">{result.errors.length}</span> erreur(s)
              </span>
            </div>
            {result.errors.length > 0 && (
              <ul className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2">
                {result.errors.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-danger">
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Ligne <span className="tnum font-semibold">{e.line}</span> — {e.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <FormError message={error} />
      </div>
    </Dialog>
  );
}
