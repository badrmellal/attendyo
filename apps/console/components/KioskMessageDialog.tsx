"use client";

/**
 * KioskMessageDialog — write (or clear) the one-shot door-side message of a
 * member ("Message d'accueil"). The Gate kiosk shows it as a gold card under
 * the greeting on that member's next GRANTED entry, reads it aloud, then the
 * API clears it atomically — delivered exactly once. Saving an empty field
 * clears a pending message. Plain `PATCH /api/members/{id}` per the contract.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, MessageSquareText, RefreshCw } from "lucide-react";
import { Dialog } from "./Dialog";
import { FormError } from "./FormField";
import { updateMember } from "@/lib/api";
import type { Member } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_LENGTH = 140;

export function KioskMessageDialog({
  open,
  member,
  onClose,
  onSaved,
}: {
  open: boolean;
  member: Member | null;
  onClose: () => void;
  onSaved: (member: Member) => void;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(member?.kiosk_message ?? "");
    setError(null);
    setSubmitting(false);
  }, [member, open]);

  async function submit() {
    if (!member) return;
    setError(null);
    setSubmitting(true);
    try {
      // Empty string = clear the pending message (contract: one-shot note).
      const saved = await updateMember(member.id, { kiosk_message: text.trim() });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!member) return null;

  const hadMessage = !!member.kiosk_message;
  const clearing = hadMessage && text.trim() === "";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Message d'accueil"
      description={member.full_name}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-ghost px-4 py-2 text-sm" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {clearing ? "Effacer le message" : "Enregistrer"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="flex items-start gap-2 rounded-lg border border-accent/25 bg-accent/[0.06] px-3 py-2 text-xs text-text-muted">
          <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          Affiché et lu à la porte à sa prochaine entrée, une seule fois.
        </p>

        <div>
          <textarea
            className="field w-full resize-none px-3 py-2 text-sm"
            rows={3}
            maxLength={MAX_LENGTH}
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            placeholder="ex. Réunion déplacée à 14 h — salle B"
            aria-label="Message d'accueil"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-text-muted/80">
            <span>Laissez vide puis enregistrez pour annuler le message.</span>
            <span
              className={cn("tnum", text.length >= MAX_LENGTH && "font-medium text-accent")}
            >
              {text.length}/{MAX_LENGTH}
            </span>
          </div>
        </div>

        <FormError message={error} />
      </div>
    </Dialog>
  );
}
