"use client";

/**
 * Settings — the white-label branding editor plus attendance config, with a live
 * preview that reflects edits instantly. Saving PUTs /api/settings and updates
 * the running theme via BrandingProvider, so the whole Console recolors at once.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Save,
  RotateCcw,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Check,
  Loader2,
  Globe,
  ArrowDownLeft,
} from "lucide-react";
import { BrandMark } from "@/components/BrandLogo";
import { Pill } from "@/components/StatusPill";
import { useBranding } from "@/components/BrandingProvider";
import { getSettings, putSettings } from "@/lib/api";
import { applyBrandingColors } from "@/lib/branding";
import { TERMINOLOGY_PRESETS, memberTypeOptions, terminologyLabels } from "@/lib/terminology";
import type { Branding, Locale, Settings } from "@/lib/types";
import { cn, hexToRgbTriplet } from "@/lib/utils";

const LOCALES: { value: Locale; label: string }[] = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
];

export default function SettingsPage() {
  const { setBranding: applyToApp } = useBranding();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        // Older backends may not send the v2 terminology preset or the v2.1
        // security block yet — normalize to the contract defaults.
        const normalized: Settings = {
          ...s,
          branding: { ...s.branding, terminology: s.branding.terminology ?? "workforce" },
          security: s.security ?? { alert_cooldown_seconds: 45 },
        };
        setSettings(normalized);
        setDraft(normalized);
      })
      .finally(() => setLoading(false));
  }, []);

  // Live preview: as the draft branding changes, push colors to the document so
  // the preview card (and chrome) reflect edits immediately. On unmount/save we
  // re-apply the committed branding.
  useEffect(() => {
    if (draft) applyBrandingColors(draft.branding);
  }, [draft]);

  useEffect(() => {
    return () => {
      if (settings) applyBrandingColors(settings.branding);
    };
  }, [settings]);

  const dirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(draft),
    [settings, draft],
  );

  function patchBranding(patch: Partial<Branding>) {
    setDraft((d) => (d ? { ...d, branding: { ...d.branding, ...patch } } : d));
    setSaved(false);
  }

  function patchAttendance(patch: Partial<Settings["attendance"]>) {
    setDraft((d) => (d ? { ...d, attendance: { ...d.attendance, ...patch } } : d));
    setSaved(false);
  }

  function patchSecurity(patch: Partial<Settings["security"]>) {
    setDraft((d) => (d ? { ...d, security: { ...d.security, ...patch } } : d));
    setSaved(false);
  }

  function reset() {
    if (settings) {
      setDraft(settings);
      applyBrandingColors(settings.branding);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await putSettings(draft);
      setSettings(next);
      setDraft(next);
      applyToApp(next.branding); // commit to the running app (colors + locale)
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !draft) {
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card h-96 lg:col-span-2" />
        <div className="card h-96" />
      </div>
    );
  }

  const b = draft.branding;
  const primaryValid = !!hexToRgbTriplet(b.primary_color);
  const accentValid = !!hexToRgbTriplet(b.accent_color);
  // Live terminology preview — recomputed as the draft preset changes.
  const termPreview = terminologyLabels(b.terminology);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-text">Paramètres</h2>
          <p className="text-sm text-text-muted">
            Identité de marque (white-label) et configuration de présence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              type="button"
              onClick={reset}
              className="btn-ghost inline-flex items-center gap-2 px-4 py-2 text-sm"
            >
              <RotateCcw className="h-4 w-4" /> Réinitialiser
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving || !primaryValid || !accentValid}
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <Check className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saved ? "Enregistré" : "Enregistrer"}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Editor */}
        <div className="space-y-6 lg:col-span-2">
          {/* Branding */}
          <section className="card p-6">
            <div className="mb-5 flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                <Palette className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-display font-semibold text-text">Identité de marque</h3>
                <p className="text-xs text-text-muted">Lue depuis GET /api/settings → branding</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom du produit">
                <input
                  className="field w-full px-3 py-2 text-sm"
                  value={b.product_name}
                  onChange={(e) => patchBranding({ product_name: e.target.value })}
                />
              </Field>
              <Field label="Logo (URL)">
                <input
                  className="field w-full px-3 py-2 text-sm"
                  value={b.logo_url ?? ""}
                  placeholder="https://…/logo.svg (optionnel)"
                  onChange={(e) => patchBranding({ logo_url: e.target.value || null })}
                />
              </Field>
            </div>

            <Field label="Slogan" className="mt-4">
              <input
                className="field w-full px-3 py-2 text-sm"
                value={b.tagline}
                onChange={(e) => patchBranding({ tagline: e.target.value })}
              />
            </Field>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <ColorField
                label="Couleur primaire"
                value={b.primary_color}
                valid={primaryValid}
                onChange={(v) => patchBranding({ primary_color: v })}
              />
              <ColorField
                label="Couleur d'accent"
                value={b.accent_color}
                valid={accentValid}
                onChange={(v) => patchBranding({ accent_color: v })}
              />
            </div>

            <Field label="Langue" className="mt-4">
              <div className="inline-flex rounded-lg border border-border bg-surface-2/40 p-1">
                {LOCALES.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => patchBranding({ locale: l.value })}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      b.locale === l.value
                        ? "bg-surface text-text shadow-sm"
                        : "text-text-muted hover:text-text",
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Terminologie" className="mt-4">
              <div className="grid gap-2 sm:grid-cols-3">
                {TERMINOLOGY_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => patchBranding({ terminology: p.value })}
                    aria-pressed={b.terminology === p.value}
                    className={cn(
                      "rounded-xl border px-3.5 py-3 text-left transition-colors",
                      b.terminology === p.value
                        ? "border-primary/40 bg-primary/[0.06]"
                        : "border-border hover:bg-surface-2/40",
                    )}
                  >
                    <span
                      className={cn(
                        "block text-sm font-medium",
                        b.terminology === p.value ? "text-primary" : "text-text",
                      )}
                    >
                      {p.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-text-muted">{p.hint}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-text-muted/80">
                Relabellise toute la Console — menu, filtres, rapports — sans redéploiement.
              </p>
            </Field>
          </section>

          {/* Attendance config */}
          <section className="card p-6">
            <div className="mb-5 flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
                <SlidersHorizontal className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-display font-semibold text-text">Présence</h3>
                <p className="text-xs text-text-muted">Stratégie de pointage et anti-rebond</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Stratégie entrée/sortie">
                <select className="field w-full px-3 py-2 text-sm" value={draft.attendance.in_out_strategy} disabled>
                  <option value="first_in_last_out">Première entrée / Dernière sortie</option>
                </select>
              </Field>
              <Field label="Délai anti-rebond (s)">
                <input
                  type="number"
                  min={0}
                  className="field w-full px-3 py-2 text-sm tnum"
                  value={draft.attendance.min_revisit_seconds}
                  onChange={(e) =>
                    patchAttendance({ min_revisit_seconds: Number(e.target.value) || 0 })
                  }
                />
              </Field>
            </div>

            <label className="mt-4 flex cursor-pointer items-center justify-between rounded-lg border border-border bg-surface-2/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-text">Ouverture auto à l'autorisation</p>
                <p className="text-xs text-text-muted">
                  Déclenche le pilote de porte dès qu'un accès est autorisé.
                </p>
              </div>
              <Toggle
                checked={draft.attendance.auto_open_on_grant}
                onChange={(v) => patchAttendance({ auto_open_on_grant: v })}
              />
            </label>
          </section>

          {/* Security config (v2.1 Smart Gate) */}
          <section className="card p-6">
            <div className="mb-5 flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-info/10 text-info ring-1 ring-info/20">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-display font-semibold text-text">Sécurité</h3>
                <p className="text-xs text-text-muted">Anti-bruit des alertes à la porte</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Délai entre alertes (s)">
                <input
                  type="number"
                  min={0}
                  className="field w-full px-3 py-2 text-sm tnum"
                  value={draft.security.alert_cooldown_seconds}
                  onChange={(e) =>
                    patchSecurity({
                      alert_cooldown_seconds: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </Field>
            </div>
            <p className="mt-2 text-xs text-text-muted/80">
              Au plus une alerte par porte et par type pendant ce délai — un inconnu qui
              reste devant la porte ne génère qu'une seule alerte, pas une par image. Les
              événements restent tous journalisés.
            </p>
          </section>
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="card overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Aperçu en direct
              </p>
            </div>
            <div className="space-y-4 p-5">
              {/* Brand header preview */}
              <div className="flex items-center gap-2.5">
                {b.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.logo_url} alt={b.product_name} className="h-7 w-auto object-contain" />
                ) : (
                  <BrandMark size={28} />
                )}
                <span className="font-display text-lg font-semibold text-text">
                  {b.product_name || "—"}
                </span>
              </div>
              <p className="text-sm text-text-muted">{b.tagline}</p>

              {/* Token chips */}
              <div className="flex flex-wrap gap-2">
                <Pill tone="ok">Autorisé</Pill>
                <Pill tone="warn">En retard</Pill>
                <Pill tone="danger">Refusé</Pill>
              </div>

              {/* Buttons */}
              <div className="flex gap-2">
                <button className="btn-primary px-3 py-1.5 text-sm" type="button">
                  Action primaire
                </button>
                <button className="btn-ghost px-3 py-1.5 text-sm" type="button">
                  Secondaire
                </button>
              </div>

              {/* A granted-entry sample row */}
              <div className="flex items-center gap-3 rounded-xl border border-primary/15 bg-primary/[0.04] px-3 py-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                  <ArrowDownLeft className="h-4 w-4" />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text">Yasmine El Amrani</p>
                  <p className="text-xs text-text-muted">Entrée Principale</p>
                </div>
                <span className="text-xs font-medium text-primary">Autorisé</span>
              </div>

              {/* Terminology preview */}
              <div className="rounded-lg bg-surface-2/40 px-3 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Terminologie —{" "}
                  {TERMINOLOGY_PRESETS.find((p) => p.value === b.terminology)?.label}
                </p>
                <p className="mt-1.5 text-xs text-text-muted">
                  Menu : <span className="font-medium text-text">{termPreview.peopleNav}</span>
                </p>
                <p className="text-xs text-text-muted">
                  Champ :{" "}
                  <span className="font-medium text-text">{termPreview.departmentLabel}</span>
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {memberTypeOptions(termPreview)
                    .slice(0, 3)
                    .map((o) => (
                      <span
                        key={o.value}
                        className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text-muted"
                      >
                        {o.label}
                      </span>
                    ))}
                </div>
              </div>

              {/* Locale note */}
              <div className="flex items-center gap-2 rounded-lg bg-surface-2/40 px-3 py-2 text-xs text-text-muted">
                <Globe className="h-3.5 w-3.5" />
                Langue: {LOCALES.find((l) => l.value === b.locale)?.label}
                {b.locale === "ar" && " · RTL"}
              </div>
            </div>
          </div>
          <p className="mt-3 px-1 text-xs text-text-muted">
            Les couleurs sont appliquées à toute la Console au moment de l'enregistrement.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function ColorField({
  label,
  value,
  valid,
  onChange,
}: {
  label: string;
  value: string;
  valid: boolean;
  onChange: (v: string) => void;
}) {
  // Native color input needs a clean #rrggbb; fall back gracefully.
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#5663F2";
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-border">
          <input
            type="color"
            value={safe}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="absolute -inset-2 h-[calc(100%+16px)] w-[calc(100%+16px)] cursor-pointer"
            aria-label={label}
          />
        </div>
        <input
          className={cn("field flex-1 px-3 py-2 text-sm tnum uppercase", !valid && "border-danger/50")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </div>
      {!valid && <p className="mt-1 text-xs text-danger">Couleur hexadécimale invalide</p>}
    </Field>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200",
        checked ? "bg-primary" : "bg-surface-2 ring-1 ring-border",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
