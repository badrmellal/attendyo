"use client";

/**
 * UserDialog — create / edit a Console operator (`/api/users`, admin only).
 * Email is immutable after creation; the password is required on create and
 * optional on edit (leave blank to keep the current one). Each role carries a
 * one-line description so an admin can't mis-assign by accident.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { Dialog } from "./Dialog";
import { FormField, FormError } from "./FormField";
import { createUser, updateUser } from "@/lib/api";
import type { OperatorRole, OperatorUser } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROLES: { value: OperatorRole; label: string; description: string }[] = [
  {
    value: "admin",
    label: "Administrateur",
    description: "Tous les droits — paramètres, équipe, audit inclus.",
  },
  {
    value: "operator",
    label: "Opérateur",
    description: "Gestion quotidienne : personnes, portes, alertes, rapports.",
  },
  {
    value: "viewer",
    label: "Lecteur",
    description: "Lecture seule : tableaux de bord et rapports.",
  },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function UserDialog({
  open,
  user,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = create. */
  user: OperatorUser | null;
  onClose: () => void;
  onSaved: (user: OperatorUser) => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<OperatorRole>("operator");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmail(user?.email ?? "");
    setFullName(user?.full_name ?? "");
    setRole(user?.role ?? "operator");
    setPassword("");
    setError(null);
    setSubmitting(false);
  }, [open, user]);

  async function submit() {
    setError(null);
    if (!user) {
      if (!EMAIL_RE.test(email.trim())) {
        setError("Adresse e-mail invalide.");
        return;
      }
      if (password.length < 8) {
        setError("Le mot de passe doit contenir au moins 8 caractères.");
        return;
      }
    } else if (password && password.length < 8) {
      setError("Le nouveau mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    setSubmitting(true);
    try {
      const saved = user
        ? await updateUser(user.id, {
            full_name: fullName.trim() || undefined,
            role,
            ...(password ? { password } : {}),
          })
        : await createUser({
            email: email.trim(),
            full_name: fullName.trim() || undefined,
            role,
            password,
          });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={user ? "Modifier l'opérateur" : "Nouvel opérateur"}
      description={user?.email}
      size="md"
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
            Enregistrer
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FormField label="Adresse e-mail" required={!user}>
          <input
            type="email"
            className="field w-full px-3 py-2 text-sm disabled:opacity-60"
            value={email}
            disabled={!!user}
            autoFocus={!user}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nom@entreprise.ma"
          />
        </FormField>

        <FormField label="Nom complet">
          <input
            className="field w-full px-3 py-2 text-sm"
            value={fullName}
            autoFocus={!!user}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="ex. Salma Tazi"
          />
        </FormField>

        <FormField label="Rôle" required>
          <div className="space-y-2">
            {ROLES.map((r) => (
              <label
                key={r.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                  role === r.value
                    ? "border-primary/40 bg-primary/[0.06]"
                    : "border-border hover:bg-surface-2/40",
                )}
              >
                <input
                  type="radio"
                  name="operator-role"
                  checked={role === r.value}
                  onChange={() => setRole(r.value)}
                  className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]"
                />
                <span>
                  <span className="block text-sm font-medium text-text">{r.label}</span>
                  <span className="block text-xs text-text-muted">{r.description}</span>
                </span>
              </label>
            ))}
          </div>
        </FormField>

        <FormField
          label={user ? "Nouveau mot de passe" : "Mot de passe"}
          required={!user}
          hint={user ? "Laissez vide pour conserver le mot de passe actuel." : "8 caractères minimum."}
        >
          <input
            type="password"
            className="field w-full px-3 py-2 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </FormField>

        <FormError message={error} />
      </div>
    </Dialog>
  );
}
