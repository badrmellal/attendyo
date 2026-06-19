"use client";

/**
 * ConfirmDialog — a small, reusable confirm-before-destructive-action modal built
 * on the shared Dialog shell. Used for every delete in the Console so we never
 * remove a member, door, or camera without an explicit confirmation. The confirm
 * button can be tinted danger and shows a spinner while the action is pending.
 */

import { useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { Dialog } from "./Dialog";
import { cn } from "@/lib/utils";

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  tone = "danger",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    setPending(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'action a échoué.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={pending ? () => {} : onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button
            type="button"
            className="btn-ghost px-4 py-2 text-sm"
            onClick={onClose}
            disabled={pending}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-semibold text-[#FBFAFF] transition-[filter,transform] disabled:opacity-50",
              tone === "danger"
                ? "bg-danger shadow-[0_8px_24px_-10px_rgb(var(--danger)/0.6)] hover:brightness-110 active:translate-y-px"
                : "btn-primary",
            )}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
            tone === "danger"
              ? "border-danger/25 bg-danger/10 text-danger"
              : "border-primary/25 bg-primary/10 text-primary",
          )}
        >
          <TriangleAlert className="h-5 w-5" />
        </span>
        <div className="min-w-0 space-y-2 text-sm text-text-muted">
          {description}
          {error && (
            <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
