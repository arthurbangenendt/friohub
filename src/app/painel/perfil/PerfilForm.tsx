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

export type TagCatalogo = { slug: string; label: string; categoria: string };

// Ordem e texto de apoio de cada grupo de tags detalhadas.
const CATEGORIAS: { id: string; titulo: string; ajuda: string }[] = [
  { id: "servico", titulo: "Serviços que você executa", ajuda: "O detalhe do que você faz dentro de cada especialidade." },
  { id: "equipamento", titulo: "Equipamentos que domina", ajuda: "Split, cassete, VRF, chiller — o cliente filtra por isso." },
  { id: "ambiente", titulo: "Ambientes que atende", ajuda: "Residencial, corporativo, industrial, hospitalar." },
  { id: "credencial", titulo: "Credenciais e diferenciais", ajuda: "Conferidas na verificação do seu perfil." },
];

type SkillState = Record<string, { checked: boolean; years: number }>;

export function PerfilForm({ inicial, catalogo }: { inicial: PerfilInput; catalogo: TagCatalogo[] }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<"autonomo" | "empresa">(inicial.tipo);
  const [razaoSocial, setRazaoSocial] = useState(inicial.razaoSocial);
  const [bio, setBio] = useState(inicial.bio);
  const [cidade, setCidade] = useState(inicial.cidade);
  const [cepPrefix, setCepPrefix] = useState(inicial.cepPrefix);
  const [anos, setAnos] = useState(inicial.anosExperiencia);
  const [tags, setTags] = useState<Set<string>>(() => new Set(inicial.tags));
  const [skills, setSkills] = useState<SkillState>(() => {
    const base: SkillState = {};
    for (const [spec] of SPEC_LABEL) base[spec] = { checked: false, years: 0 };
    for (const s of inicial.skills) base[s.specialty] = { checked: true, years: s.years };
    return base;
  });

  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  function toggleTag(slug: string) {
    setTags((cur) => {
      const prox = new Set(cur);
      if (prox.has(slug)) prox.delete(slug); else prox.add(slug);
      return prox;
    });
  }

  function salvar() {
    setErro(null);
    setSalvo(false);
    const payload: PerfilInput = {
      tipo, razaoSocial, bio, cidade, cepPrefix,
      anosExperiencia: anos,
      skills: SPEC_LABEL.filter(([s]) => skills[s].checked).map(([s]) => ({ specialty: s, years: skills[s].years })),
      tags: [...tags],
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

      <Campo label="Anos de experiência com climatização">
        <input type="number" min={0} max={60} value={anos} onChange={(e) => setAnos(+e.target.value)}
          style={{ ...input, maxWidth: 140 }} />
      </Campo>

      <Campo label="Sobre você">
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} style={{ ...input, height: "auto", padding: 12, resize: "vertical" }} placeholder="Experiência, diferenciais, o que você faz de melhor." />
      </Campo>

      <Campo label="Especialidades">
        <span style={ajudaTxt}>São elas que definem em quais buscas você aparece e onde sua nota é calculada.</span>
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

      {/* ---- camada de detalhe ---- */}
      {CATEGORIAS.map((cat) => {
        const itens = catalogo.filter((t) => t.categoria === cat.id);
        if (itens.length === 0) return null;
        const marcadas = itens.filter((i) => tags.has(i.slug)).length;
        return (
          <Campo key={cat.id} label={`${cat.titulo}${marcadas ? ` (${marcadas})` : ""}`}>
            <span style={ajudaTxt}>{cat.ajuda}</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {itens.map((i) => {
                const on = tags.has(i.slug);
                return (
                  <button key={i.slug} type="button" onClick={() => toggleTag(i.slug)}
                    style={{
                      padding: "8px 14px", borderRadius: 100, fontSize: 13.5, cursor: "pointer",
                      fontWeight: on ? 600 : 500,
                      border: `1px solid ${on ? "var(--cool)" : "var(--line)"}`,
                      background: on ? "var(--cool-wash)" : "var(--surface)",
                      color: on ? "var(--cool-deep)" : "var(--ink-soft)",
                    }}>
                    {i.label}
                  </button>
                );
              })}
            </div>
          </Campo>
        );
      })}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Campo label="Cidade"><input value={cidade} onChange={(e) => setCidade(e.target.value)} style={input} /></Campo>
        <Campo label="Atende CEPs iniciados em"><input value={cepPrefix} onChange={(e) => setCepPrefix(e.target.value)} style={input} placeholder="01" /></Campo>
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
const ajudaTxt: React.CSSProperties = { fontSize: 12.5, color: "var(--ink-faint)", marginTop: -4 };
