"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LocationMap } from "@/components/ui/expand-map";
import { detectarLocalizacaoDetalhada } from "@/lib/cep";
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
  { id: "credencial", titulo: "Credenciais e diferenciais", ajuda: "Autodeclaradas. A equipe pode conferir e liberar o selo de verificado." },
];

type SkillState = Record<string, { checked: boolean; years: number }>;
type BaseAtendimento = Omit<NonNullable<PerfilInput["serviceRadius"]>, "radiusKm">;

export function PerfilForm({ inicial, catalogo }: { inicial: PerfilInput; catalogo: TagCatalogo[] }) {
  const router = useRouter();
  // Perfil ainda não montado: a primeira conclusão leva à escolha de plano.
  const primeiraVez = inicial.skills.length === 0;
  const [tipo, setTipo] = useState<"autonomo" | "empresa">(inicial.tipo);
  const [razaoSocial, setRazaoSocial] = useState(inicial.razaoSocial);
  const [bio, setBio] = useState(inicial.bio);
  const [cidade, setCidade] = useState(inicial.cidade);
  const [baseAtendimento, setBaseAtendimento] = useState<BaseAtendimento | null>(() => inicial.serviceRadius ? {
    latitude: inicial.serviceRadius.latitude,
    longitude: inicial.serviceRadius.longitude,
    locationLabel: inicial.serviceRadius.locationLabel,
    accuracyM: inicial.serviceRadius.accuracyM,
    cep: inicial.serviceRadius.cep,
  } : null);
  const [radiusKm, setRadiusKm] = useState(inicial.serviceRadius?.radiusKm ?? 25);
  const [localizando, setLocalizando] = useState(false);
  const [geoAviso, setGeoAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
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

  async function usarLocalizacaoAtual() {
    setLocalizando(true);
    setGeoAviso(null);
    const resultado = await detectarLocalizacaoDetalhada((coordenadas) => {
      setBaseAtendimento({
        latitude: coordenadas.latitude,
        longitude: coordenadas.longitude,
        locationLabel: cidade.trim() || "Localização atual",
        accuracyM: coordenadas.accuracy,
        cep: "",
      });
    });
    setLocalizando(false);

    if (resultado.status !== "ok") {
      const mensagens = {
        negado: "A localização está bloqueada. No Chrome, clique no ícone ao lado do endereço, permita Localização e tente novamente.",
        indisponivel: "Este navegador não oferece localização. Tente em um dispositivo compatível.",
        erro: "Não foi possível obter sua localização. No Mac, confira Ajustes do Sistema → Privacidade e Segurança → Serviços de Localização → Google Chrome.",
      } as const;
      setGeoAviso({ tipo: "erro", texto: mensagens[resultado.status] });
      return;
    }

    const cidadeDetectada = resultado.cidade.trim();
    if (cidadeDetectada) setCidade(cidadeDetectada);
    const locationLabel = [cidadeDetectada || cidade.trim() || "Localização atual", resultado.uf]
      .filter(Boolean)
      .join(", ");
    setBaseAtendimento({
      latitude: resultado.latitude,
      longitude: resultado.longitude,
      locationLabel,
      accuracyM: resultado.accuracy,
      cep: resultado.cep,
    });
    setGeoAviso({ tipo: "ok", texto: "Localização encontrada. O ponto no mapa marca sua base atual." });
  }

  function salvar() {
    setErro(null);
    setSalvo(false);
    const payload: PerfilInput = {
      tipo, razaoSocial, bio, cidade, cepPrefix: inicial.cepPrefix,
      anosExperiencia: anos,
      skills: SPEC_LABEL.filter(([s]) => skills[s].checked).map(([s]) => ({ specialty: s, years: skills[s].years })),
      tags: [...tags],
      serviceRadius: baseAtendimento ? { ...baseAtendimento, radiusKm } : null,
    };
    if (payload.skills.length === 0) { setErro("Selecione ao menos uma especialidade."); return; }
    start(async () => {
      const r = await salvarPerfil(payload);
      if (!r.ok) { setErro(r.error ?? "Erro ao salvar."); return; }
      setSalvo(true);
      router.refresh();
      /* Fim do cadastro de parceiro: com o perfil técnico salvo, ele já sabe o
         que está comprando e cai na escolha de plano. A vitrine — que antes era
         o destino aqui — continua a um clique, como link na tela de planos:
         ver o próprio perfil é recompensa, escolher plano é o próximo passo. */
      if (primeiraVez) router.push(`/planos?novo=1`);
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

      <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="flex flex-col gap-4 border-b border-[var(--line)] bg-[linear-gradient(135deg,var(--cool-wash),var(--surface))] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--cool)] text-white shadow-sm" aria-hidden="true">
              <MapIcon />
            </span>
            <div>
              <h2 className="text-base font-extrabold text-[var(--ink)]">Área de atendimento</h2>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-[var(--ink-soft)]">
                Use sua base atual e escolha a distância máxima que você aceita percorrer. Suas coordenadas exatas ficam privadas.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={usarLocalizacaoAtual}
            disabled={localizando}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--ink)] px-4 text-sm font-bold text-[var(--surface)] shadow-sm transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60"
          >
            <LocateIcon />
            {localizando ? "Localizando..." : baseAtendimento ? "Atualizar localização" : "Usar minha localização"}
          </button>
        </div>

        {geoAviso && (
          <div
            role={geoAviso.tipo === "erro" ? "alert" : "status"}
            className="mx-5 mt-5 flex items-start gap-2 rounded-xl border px-3.5 py-3 text-xs font-semibold leading-relaxed"
            style={{
              borderColor: geoAviso.tipo === "ok" ? "var(--cool)" : "var(--warm)",
              background: geoAviso.tipo === "ok" ? "var(--cool-wash)" : "var(--warm-wash)",
              color: geoAviso.tipo === "ok" ? "var(--cool-deep)" : "var(--ink)",
            }}
          >
            <span aria-hidden="true">{geoAviso.tipo === "ok" ? "✓" : "⚠"}</span>
            <span>{geoAviso.texto}</span>
          </div>
        )}

        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(320px,1.18fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <Campo label="Cidade exibida no perfil">
              <input
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                style={input}
                placeholder="Ex.: São Paulo"
              />
            </Campo>

            <div className="flex flex-col gap-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[13.5px] font-semibold text-[var(--ink-soft)]">Distância máxima</p>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">Até onde você aceita se deslocar a partir da base.</p>
                </div>
                <label className="flex shrink-0 items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3">
                  <input
                    type="number"
                    min={5}
                    max={150}
                    step={5}
                    value={radiusKm}
                    onChange={(e) => setRadiusKm(Math.min(150, Math.max(5, Number(e.target.value) || 5)))}
                    className="h-10 w-12 bg-transparent text-right text-base font-extrabold text-[var(--cool-deep)] outline-none"
                    aria-label="Raio de atendimento em quilômetros"
                  />
                  <span className="text-xs font-bold text-[var(--ink-soft)]">km</span>
                </label>
              </div>
              <input
                type="range"
                min={5}
                max={150}
                step={5}
                value={radiusKm}
                onChange={(e) => setRadiusKm(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-[var(--cool)]"
                aria-label="Ajustar raio de atendimento"
              />
              <div className="grid grid-cols-4 gap-2">
                {[10, 25, 50, 100].map((km) => (
                  <button
                    key={km}
                    type="button"
                    onClick={() => setRadiusKm(km)}
                    className="rounded-lg border px-2 py-2 text-xs font-bold transition"
                    style={{
                      borderColor: radiusKm === km ? "var(--cool)" : "var(--line)",
                      background: radiusKm === km ? "var(--cool-wash)" : "var(--bg)",
                      color: radiusKm === km ? "var(--cool-deep)" : "var(--ink-soft)",
                    }}
                  >
                    {km} km
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs leading-relaxed text-[var(--ink-soft)]">
              <strong className="text-[var(--ink)]">Como funciona:</strong>{" "}
              o círculo mostra visualmente seu limite de deslocamento. Para trocar a base, atualize sua localização.
              {baseAtendimento?.accuracyM !== null && baseAtendimento?.accuracyM !== undefined && (
                <span className="mt-1 block text-[var(--ink-faint)]">Precisão aproximada do dispositivo: {formatarPrecisao(baseAtendimento.accuracyM)}.</span>
              )}
            </div>

          </div>

          <LocationMap
            location={baseAtendimento?.locationLabel || cidade}
            latitude={baseAtendimento?.latitude ?? null}
            longitude={baseAtendimento?.longitude ?? null}
            radiusKm={radiusKm}
            locating={localizando}
            onRequestLocation={usarLocalizacaoAtual}
          />
        </div>
      </section>

      {erro && <p style={{ color: "var(--danger)", fontSize: 14 }}>{erro}</p>}
      {salvo && <p style={{ color: "var(--good)", fontSize: 14, fontWeight: 600 }}>Perfil salvo! Você já aparece nas buscas dos clientes.</p>}

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

function formatarPrecisao(metros: number) {
  if (metros < 1000) return `${Math.max(1, metros)} m`;
  return `${(metros / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}

function MapIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z" />
      <path d="M9 3v15M15 6v15" />
    </svg>
  );
}

function LocateIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
    </svg>
  );
}
