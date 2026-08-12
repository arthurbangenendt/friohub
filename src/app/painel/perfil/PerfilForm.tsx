"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarPerfil, type PerfilInput } from "./actions";

const SPEC_LABEL: [string, string][] = [
  ["instalacao", "Instalação"],
  ["manutencao", "Manutenção"],
  ["limpeza", "Limpeza"],
  ["remanejamento", "Remanejamento"],
  ["conserto", "Conserto"],
];

type SkillState = Record<string, { checked: boolean; years: number }>;

export function PerfilForm({ inicial }: { inicial: PerfilInput }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<"autonomo" | "empresa">(inicial.tipo);
  const [razaoSocial, setRazaoSocial] = useState(inicial.razaoSocial);
  const [bio, setBio] = useState(inicial.bio);
  const [cidade, setCidade] = useState(inicial.cidade);
  const [cepPrefix, setCepPrefix] = useState(inicial.cepPrefix);
  const [skills, setSkills] = useState<SkillState>(() => {
    const base: SkillState = {};
    for (const [spec] of SPEC_LABEL) base[spec] = { checked: false, years: 0 };
    for (const s of inicial.skills) base[s.specialty] = { checked: true, years: s.years };
    return base;
  });

  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  function salvar() {
    setErro(null);
    setSalvo(false);
    const payload: PerfilInput = {
      tipo, razaoSocial, bio, cidade, cepPrefix,
      skills: SPEC_LABEL.filter(([s]) => skills[s].checked).map(([s]) => ({ specialty: s, years: skills[s].years })),
    };
    if (payload.skills.length === 0) { setErro("Selecione ao menos uma especialidade."); return; }
    start(async () => {
      const r = await salvarPerfil(payload);
      if (r.ok) { setSalvo(true); router.refresh(); }
      else setErro(r.error ?? "Erro ao salvar.");
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <Campo label="Você é">
        <div style={{ display: "flex", gap: 10 }}>
          {(["autonomo", "empresa"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTipo(t)}
              style={{ flex: 1, padding: "12px 14px", borderRadius: 10, border: `1px solid ${tipo === t ? "var(--cool)" : "var(--line)"}`, background: tipo === t ? "var(--cool-wash)" : "var(--surface)", color: "var(--ink)", fontWeight: 600, cursor: "pointer", boxShadow: tipo === t ? "inset 0 0 0 1px var(--cool)" : "none" }}>
              {t === "autonomo" ? "Autônomo" : "Empresa"}
            </button>
          ))}
        </div>
      </Campo>

      {tipo === "empresa" && (
        <Campo label="Razão social / nome da empresa">
          <input value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} style={input} placeholder="Ex.: Clima Norte Refrigeração" />
        </Campo>
      )}

      <Campo label="Sobre você">
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} style={{ ...input, height: "auto", padding: 12, resize: "vertical" }} placeholder="Experiência, diferenciais, o que você faz de melhor." />
      </Campo>

      <Campo label="Especialidades">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {SPEC_LABEL.map(([spec, label]) => {
            const s = skills[spec];
            return (
              <div key={spec} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: s.checked ? "var(--cool-wash)" : "var(--surface)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flex: 1, fontWeight: 600 }}>
                  <input type="checkbox" checked={s.checked} onChange={(e) => setSkills({ ...skills, [spec]: { ...s, checked: e.target.checked } })} style={{ width: 18, height: 18, accentColor: "var(--cool)" }} />
                  {label}
                </label>
                {s.checked && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink-soft)" }}>
                    <input type="number" min={0} max={50} value={s.years} onChange={(e) => setSkills({ ...skills, [spec]: { ...s, years: +e.target.value } })} style={{ width: 60, height: 34, padding: "0 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)" }} />
                    anos
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </Campo>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Campo label="Cidade"><input value={cidade} onChange={(e) => setCidade(e.target.value)} style={input} /></Campo>
        <Campo label="Atende CEPs iniciados em"><input value={cepPrefix} onChange={(e) => setCepPrefix(e.target.value)} style={input} placeholder="60" /></Campo>
      </div>

      {erro && <p style={{ color: "#b3261e", fontSize: 14 }}>{erro}</p>}
      {salvo && <p style={{ color: "var(--good)", fontSize: 14, fontWeight: 600 }}>Perfil salvo! Você já aparece nas buscas.</p>}

      <button className="btn btn-primary" onClick={salvar} disabled={pending} style={{ alignSelf: "flex-start", opacity: pending ? 0.7 : 1 }}>
        {pending ? "Salvando..." : "Salvar perfil"}
      </button>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 13.5, fontWeight: 650, color: "var(--ink-soft)" }}>{label}</span>
      {children}
    </label>
  );
}

const input: React.CSSProperties = { height: 44, padding: "0 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: 15, width: "100%" };
