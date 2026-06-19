"use client";

/**
 * EnrollDialog — add a person from a SINGLE photo. Two capture modes: upload a
 * file, or take a live webcam shot. The copy emphasizes the product's core
 * promise: one photo is enough to enroll someone for recognition at the gate.
 *
 * On submit it calls `enrollMember` (POST /api/members, multipart). In demo/mock
 * mode the new member is appended to the in-memory list.
 */

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Upload,
  Sparkles,
  RefreshCw,
  CircleAlert,
  CheckCircle2,
} from "lucide-react";
import { Dialog } from "./Dialog";
import { enrollMember } from "@/lib/api";
import type { Member, MemberDraft, MemberType } from "@/lib/types";
import { cn } from "@/lib/utils";

const MEMBER_TYPES: { value: MemberType; label: string }[] = [
  { value: "employee", label: "Employé" },
  { value: "resident", label: "Résident" },
  { value: "contractor", label: "Prestataire" },
  { value: "visitor", label: "Visiteur" },
];

type Mode = "upload" | "webcam";

export function EnrollDialog({
  open,
  onClose,
  onEnrolled,
  departments,
}: {
  open: boolean;
  onClose: () => void;
  onEnrolled: (member: Member) => void;
  departments: string[];
}) {
  const [mode, setMode] = useState<Mode>("upload");
  const [draft, setDraft] = useState<MemberDraft>({ full_name: "", member_type: "employee" });
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Webcam wiring
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);

  // Reset everything when the dialog closes.
  useEffect(() => {
    if (!open) {
      stopCamera();
      setMode("upload");
      setDraft({ full_name: "", member_type: "employee" });
      setImage(null);
      setPreview((p) => {
        if (p) URL.revokeObjectURL(p);
        return null;
      });
      setError(null);
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Manage the camera stream when entering/leaving webcam mode.
  useEffect(() => {
    if (open && mode === "webcam" && !preview) startCamera();
    else stopCamera();
    return stopCamera;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, preview]);

  async function startCamera() {
    setCamError(null);
    setCamReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCamReady(true);
      }
    } catch {
      setCamError("Caméra indisponible. Autorisez l'accès ou utilisez l'import de fichier.");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamReady(false);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageBlob(file);
  }

  function setImageBlob(blob: Blob) {
    if (preview) URL.revokeObjectURL(preview);
    const url = URL.createObjectURL(blob);
    setImage(blob);
    setPreview(url);
    setError(null);
  }

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Mirror horizontally so the saved photo matches what the user sees.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          stopCamera();
          setImageBlob(blob);
        }
      },
      "image/jpeg",
      0.92,
    );
  }

  function retake() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setImage(null);
  }

  async function submit() {
    setError(null);
    if (!draft.full_name.trim()) {
      setError("Le nom complet est requis.");
      return;
    }
    if (!image) {
      setError("Une photo est nécessaire — une seule suffit.");
      return;
    }
    setSubmitting(true);
    try {
      const member = await enrollMember(
        { ...draft, full_name: draft.full_name.trim() },
        image,
      );
      onEnrolled(member);
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
      title="Enregistrer une personne"
      description="Une seule photo suffit pour la reconnaissance au portail."
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
      <div className="grid gap-6 md:grid-cols-2">
        {/* Capture column */}
        <div>
          <div className="mb-3 inline-flex rounded-lg border border-border bg-surface-2/40 p-1">
            <button
              type="button"
              onClick={() => setMode("upload")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                mode === "upload" ? "bg-surface text-text shadow-sm" : "text-text-muted",
              )}
            >
              <Upload className="h-4 w-4" /> Importer
            </button>
            <button
              type="button"
              onClick={() => setMode("webcam")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                mode === "webcam" ? "bg-surface text-text shadow-sm" : "text-text-muted",
              )}
            >
              <Camera className="h-4 w-4" /> Webcam
            </button>
          </div>

          <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-bg">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Aperçu" className="h-full w-full object-cover" />
            ) : mode === "upload" ? (
              <label className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 text-center text-text-muted transition-colors hover:bg-surface-2/30">
                <Upload className="h-7 w-7" />
                <span className="text-sm font-medium text-text">Cliquez pour importer</span>
                <span className="text-xs">JPG ou PNG · un seul visage net</span>
                <input type="file" accept="image/*" className="hidden" onChange={onFile} />
              </label>
            ) : (
              <>
                {/* Mirror the preview for a natural selfie view. */}
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full -scale-x-100 object-cover"
                />
                {/* Framing guide */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-[70%] w-[55%] rounded-[40%] border-2 border-primary/40" />
                </div>
                {camError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg/90 px-6 text-center">
                    <CircleAlert className="h-6 w-6 text-danger" />
                    <p className="text-sm text-text-muted">{camError}</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Capture controls */}
          <div className="mt-3 flex justify-center">
            {mode === "webcam" && !preview && (
              <button
                type="button"
                onClick={capture}
                disabled={!camReady}
                className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
              >
                <Camera className="h-4 w-4" /> Capturer
              </button>
            )}
            {preview && (
              <button
                type="button"
                onClick={retake}
                className="btn-ghost inline-flex items-center gap-2 px-4 py-2 text-sm"
              >
                <RefreshCw className="h-4 w-4" /> Reprendre
              </button>
            )}
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2.5">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-xs text-text-muted">
              <span className="font-medium text-text">Une photo suffit.</span> Le moteur crée
              l'empreinte faciale à partir d'une seule image — pas besoin de séances de capture.
            </p>
          </div>
        </div>

        {/* Details column */}
        <div className="space-y-3.5">
          <Field label="Nom complet" required>
            <input
              className="field w-full px-3 py-2 text-sm"
              value={draft.full_name}
              autoFocus
              onChange={(e) => setDraft((d) => ({ ...d, full_name: e.target.value }))}
              placeholder="ex. Yasmine El Amrani"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                className="field w-full px-3 py-2 text-sm"
                value={draft.member_type}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, member_type: e.target.value as MemberType }))
                }
              >
                {MEMBER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Identifiant">
              <input
                className="field w-full px-3 py-2 text-sm"
                value={draft.external_id ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, external_id: e.target.value }))}
                placeholder="EMP-1042"
              />
            </Field>
          </div>

          <Field label="Département">
            <input
              className="field w-full px-3 py-2 text-sm"
              list="enroll-departments"
              value={draft.department ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))}
              placeholder="ex. Finance"
            />
            <datalist id="enroll-departments">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>

          <Field label="Fonction">
            <input
              className="field w-full px-3 py-2 text-sm"
              value={draft.title ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="ex. Comptable"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="E-mail">
              <input
                type="email"
                className="field w-full px-3 py-2 text-sm"
                value={draft.email ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                placeholder="nom@entreprise.ma"
              />
            </Field>
            <Field label="Téléphone">
              <input
                className="field w-full px-3 py-2 text-sm"
                value={draft.phone ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                placeholder="+212 6…"
              />
            </Field>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
              <CircleAlert className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-muted">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  );
}
