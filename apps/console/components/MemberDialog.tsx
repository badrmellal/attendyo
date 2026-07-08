"use client";

/**
 * MemberDialog — edit an existing member. Mirrors the EnrollDialog details column
 * (same `.field` inputs, same labelled fields) but covers the full editable set:
 * type, department, title, external id, email, phone, access group, and status.
 *
 * On submit it PATCHes via `updateMember` (PATCH /api/members/{id}). The Enroll
 * (create-from-one-photo) flow stays separate and untouched.
 */

import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle2, CalendarRange } from "lucide-react";
import { Dialog } from "./Dialog";
import { FormField, FormError } from "./FormField";
import { useBranding } from "./BrandingProvider";
import { updateMember } from "@/lib/api";
import { memberTypeOptions } from "@/lib/terminology";
import type { AccessGroup, Member, MemberStatus, MemberType } from "@/lib/types";

const STATUSES: { value: MemberStatus; label: string }[] = [
  { value: "active", label: "Actif" },
  { value: "suspended", label: "Suspendu" },
  { value: "archived", label: "Archivé" },
];

type Form = {
  full_name: string;
  member_type: MemberType;
  department: string;
  title: string;
  external_id: string;
  email: string;
  phone: string;
  access_group_id: string;
  valid_from: string;
  valid_until: string;
  kiosk_message: string;
  status: MemberStatus;
};

function toForm(m: Member): Form {
  return {
    full_name: m.full_name,
    member_type: m.member_type,
    department: m.department ?? "",
    title: m.title ?? "",
    external_id: m.external_id ?? "",
    email: m.email ?? "",
    phone: m.phone ?? "",
    access_group_id: m.access_group_id ?? "",
    valid_from: m.valid_from ?? "",
    valid_until: m.valid_until ?? "",
    kiosk_message: m.kiosk_message ?? "",
    status: m.status,
  };
}

export function MemberDialog({
  open,
  member,
  accessGroups,
  departments,
  onClose,
  onSaved,
}: {
  open: boolean;
  member: Member | null;
  accessGroups: AccessGroup[];
  departments: string[];
  onClose: () => void;
  onSaved: (member: Member) => void;
}) {
  const { term } = useBranding();
  const [form, setForm] = useState<Form | null>(member ? toForm(member) : null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(member ? toForm(member) : null);
    setError(null);
    setSubmitting(false);
  }, [member, open]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function submit() {
    if (!member || !form) return;
    setError(null);
    if (!form.full_name.trim()) {
      setError("Le nom complet est requis.");
      return;
    }
    if (form.valid_from && form.valid_until && form.valid_from > form.valid_until) {
      setError("La date de début d'accès doit précéder la date de fin.");
      return;
    }
    setSubmitting(true);
    try {
      const saved = await updateMember(member.id, {
        full_name: form.full_name.trim(),
        member_type: form.member_type,
        department: form.department.trim() || undefined,
        title: form.title.trim() || undefined,
        external_id: form.external_id.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        access_group_id: form.access_group_id || undefined,
        // Explicit null CLEARS a previously-set bound (contract PATCH semantics).
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
        // One-shot door-side note — empty string clears a pending message.
        kiosk_message: form.kiosk_message.trim(),
        status: form.status,
      });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!form) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Modifier la personne"
      description={member?.full_name}
      size="lg"
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
        <FormField label="Nom complet" required>
          <input
            className="field w-full px-3 py-2 text-sm"
            value={form.full_name}
            autoFocus
            onChange={(e) => set("full_name", e.target.value)}
            placeholder="ex. Yasmine El Amrani"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Type">
            <select
              className="field w-full px-3 py-2 text-sm"
              value={form.member_type}
              onChange={(e) => set("member_type", e.target.value as MemberType)}
            >
              {memberTypeOptions(term).map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Statut">
            <select
              className="field w-full px-3 py-2 text-sm"
              value={form.status}
              onChange={(e) => set("status", e.target.value as MemberStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label={term.departmentLabel}>
            <input
              className="field w-full px-3 py-2 text-sm"
              list="member-departments"
              value={form.department}
              onChange={(e) => set("department", e.target.value)}
              placeholder="ex. Finance"
            />
            <datalist id="member-departments">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </FormField>
          <FormField label="Identifiant">
            <input
              className="field w-full px-3 py-2 text-sm"
              value={form.external_id}
              onChange={(e) => set("external_id", e.target.value)}
              placeholder="EMP-1042"
            />
          </FormField>
        </div>

        <FormField label="Fonction">
          <input
            className="field w-full px-3 py-2 text-sm"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="ex. Comptable"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="E-mail">
            <input
              type="email"
              className="field w-full px-3 py-2 text-sm"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="nom@entreprise.ma"
            />
          </FormField>
          <FormField label="Téléphone">
            <input
              className="field w-full px-3 py-2 text-sm"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+212 6…"
            />
          </FormField>
        </div>

        <FormField label="Groupe d'accès" hint="Détermine les portes que cette personne peut ouvrir.">
          <select
            className="field w-full px-3 py-2 text-sm"
            value={form.access_group_id}
            onChange={(e) => set("access_group_id", e.target.value)}
          >
            <option value="">Aucun groupe</option>
            {accessGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Message d'accueil (optionnel)"
          hint="Affiché et lu à la porte à sa prochaine entrée, une seule fois. Vide = aucun message."
        >
          <textarea
            className="field w-full resize-none px-3 py-2 text-sm"
            rows={2}
            maxLength={140}
            value={form.kiosk_message}
            onChange={(e) => set("kiosk_message", e.target.value)}
            placeholder="ex. Réunion déplacée à 14 h — salle B"
          />
        </FormField>

        {/* Temporary-access window (visitors, contractors, exchange students) */}
        <div className="rounded-xl border border-border bg-surface-2/20 p-3.5">
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-text">
            <CalendarRange className="h-3.5 w-3.5 text-accent" />
            Accès temporaire (optionnel)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Valable du">
              <input
                type="date"
                className="field tnum w-full px-3 py-2 text-sm"
                value={form.valid_from}
                max={form.valid_until || undefined}
                onChange={(e) => set("valid_from", e.target.value)}
              />
            </FormField>
            <FormField label="Jusqu'au">
              <input
                type="date"
                className="field tnum w-full px-3 py-2 text-sm"
                value={form.valid_until}
                min={form.valid_from || undefined}
                onChange={(e) => set("valid_until", e.target.value)}
              />
            </FormField>
          </div>
          <p className="mt-1.5 text-xs text-text-muted/80">
            Hors fenêtre, l&apos;accès est refusé (motif « expiré »). Laissez vide pour un accès
            permanent.
          </p>
        </div>

        <FormError message={error} />
      </div>
    </Dialog>
  );
}
