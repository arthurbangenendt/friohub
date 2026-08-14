"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { finalizarExecucao, salvarExecucao, type ExecutionState } from "./actions";
import { ANALYTICS_VERSION, captureAnalytics } from "@/lib/analytics";

type Item = { key: string; label: string };
type Draft = {
  checklist: Record<string, boolean>;
  materials: { description: string }[];
  measurements: Record<string, string>;
  evidence_paths: string[];
  notes: string | null;
  warranty_until: string | null;
  maintenance_due: string | null;
  status: string;
} | null;
const initial: ExecutionState = { ok: false, message: "" };

export function ExecutionForm({
  jobId,
  userId,
  items,
  draft,
}: {
  jobId: string;
  userId: string;
  items: Item[];
  draft: Draft;
}) {
  const [saveState, saveAction, saving] = useActionState(salvarExecucao, initial);
  const [finishState, finishAction, finishing] = useActionState(finalizarExecucao, initial);
  const [paths, setPaths] = useState<string[]>(draft?.evidence_paths ?? []);
  const [uploading, startUpload] = useTransition();
  const finalized = draft?.status === "finalized";
  const lastSave = useRef(saveState);
  const lastFinish = useRef(finishState);

  useEffect(() => {
    if (saveState !== lastSave.current) {
      lastSave.current = saveState;
      if (saveState.ok)
        captureAnalytics("execution_draft_saved", {
          evidence_count: paths.length,
          experience_version: ANALYTICS_VERSION,
        });
    }
  }, [paths.length, saveState]);
  useEffect(() => {
    if (finishState !== lastFinish.current) {
      lastFinish.current = finishState;
      if (finishState.ok) captureAnalytics("execution_finalized", { experience_version: ANALYTICS_VERSION });
    }
  }, [finishState]);

  function upload(files: FileList | null) {
    if (!files?.length) return;
    startUpload(async () => {
      const supabase = createClient();
      const uploaded = [...paths];
      for (const file of Array.from(files).slice(0, 20 - paths.length)) {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const path = `${userId}/${jobId}/${crypto.randomUUID()}-${safe}`;
        const { error } = await supabase.storage
          .from("service-evidence")
          .upload(path, file, { upsert: false });
        if (!error) uploaded.push(path);
      }
      setPaths(uploaded);
    });
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <form action={saveAction} className="card" style={{ padding: 22, display: "grid", gap: 18 }}>
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="evidencePaths" value={JSON.stringify(paths)} />
        <section>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>Checklist técnico</h2>
          <div style={{ display: "grid", gap: 9 }}>
            {items.map((item) => (
              <label key={item.key} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  name={`checklist:${item.key}`}
                  defaultChecked={draft?.checklist[item.key]}
                  disabled={finalized}
                />{" "}
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </section>
        <label>
          Materiais utilizados, um por linha
          <textarea
            name="materials"
            rows={4}
            defaultValue={draft?.materials.map((m) => m.description).join("\n")}
            disabled={finalized}
            style={field}
          />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          <label>
            Temperatura
            <input
              name="temperatura"
              defaultValue={draft?.measurements.temperatura}
              disabled={finalized}
              style={field}
            />
          </label>
          <label>
            Pressão
            <input
              name="pressao"
              defaultValue={draft?.measurements.pressao}
              disabled={finalized}
              style={field}
            />
          </label>
        </div>
        <label>
          Observações técnicas
          <textarea
            name="notes"
            maxLength={4000}
            rows={5}
            defaultValue={draft?.notes ?? ""}
            disabled={finalized}
            style={field}
          />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          <label>
            Garantia até
            <input
              type="date"
              name="warrantyUntil"
              defaultValue={draft?.warranty_until ?? ""}
              disabled={finalized}
              style={field}
            />
          </label>
          <label>
            Próxima manutenção
            <input
              type="date"
              name="maintenanceDue"
              defaultValue={draft?.maintenance_due ?? ""}
              disabled={finalized}
              style={field}
            />
          </label>
        </div>
        {!finalized && (
          <label>
            Evidências privadas
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              multiple
              onChange={(event) => upload(event.target.files)}
              disabled={uploading}
              style={{ display: "block", marginTop: 8 }}
            />
            <small style={{ color: "var(--ink-faint)" }}>
              {uploading ? "Enviando…" : `${paths.length} arquivo(s) anexado(s) · até 10 MB cada`}
            </small>
          </label>
        )}
        {!finalized && (
          <button className="btn btn-primary" disabled={saving || uploading}>
            {saving ? "Salvando…" : "Salvar rascunho"}
          </button>
        )}
        {saveState.message && (
          <p role="status" style={{ margin: 0, color: saveState.ok ? "var(--good)" : "var(--danger)" }}>
            {saveState.message}
          </p>
        )}
      </form>
      {!finalized ? (
        <form action={finishAction} className="card" style={{ padding: 22 }}>
          <input type="hidden" name="jobId" value={jobId} />
          <strong>Finalizar relatório</strong>
          <p style={{ color: "var(--ink-soft)", fontSize: 13.5 }}>
            Salve o rascunho primeiro. Depois de finalizado, este relatório não poderá ser alterado.
          </p>
          <button className="btn" disabled={finishing}>
            {finishing ? "Finalizando…" : "Finalizar e compartilhar"}
          </button>
          {finishState.message && (
            <p role="status" style={{ color: finishState.ok ? "var(--good)" : "var(--danger)" }}>
              {finishState.message}
            </p>
          )}
        </form>
      ) : (
        <div className="card" style={{ padding: 22, color: "var(--good)" }}>
          <strong>Relatório finalizado</strong>
          <p style={{ color: "var(--ink-soft)", marginBottom: 0 }}>
            O cliente já pode consultar os dados técnicos no serviço.
          </p>
        </div>
      )}
    </div>
  );
}

const field: React.CSSProperties = {
  width: "100%",
  display: "block",
  marginTop: 6,
  border: "1px solid var(--line)",
  borderRadius: 9,
  padding: 10,
  background: "var(--surface)",
  color: "var(--ink)",
  font: "inherit",
};
