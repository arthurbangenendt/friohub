"use client";

import { useEffect, useMemo, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { calcularBtu, formatarBtu } from "@/lib/btu";
import { precoInstalacao, formatarBRL } from "@/lib/pricing";
import { buscarCep, detectarLocalizacao, formatarCep } from "@/lib/cep";
import { CIDADE, ESTADO } from "@/lib/regiao";
import { criarSolicitacao, type JobType } from "./actions";
import type { ProdutoDTO, ProfissionalDTO } from "./page";
import { Wind, Wrench, Droplet, Move, Tool, Check as CheckIcon, Star, Building, User, MapPin, Search } from "@/components/icons";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

type IconType = (p: { size?: number }) => React.ReactElement;
const JOBS: { tipo: JobType; titulo: string; desc: string; Icon: IconType; equip: boolean }[] = [
  { tipo: "instalacao_com_equipamento", titulo: "Instalar ar novo", desc: "Comprar o aparelho + instalação", Icon: Wind, equip: true },
  { tipo: "manutencao", titulo: "Manutenção", desc: "Revisão, gás, não gela", Icon: Wrench, equip: false },
  { tipo: "limpeza", titulo: "Limpeza", desc: "Higienização completa", Icon: Droplet, equip: false },
  { tipo: "remanejamento", titulo: "Remanejamento", desc: "Mudar o aparelho de lugar", Icon: Move, equip: false },
  { tipo: "conserto", titulo: "Conserto", desc: "Reparo de defeito", Icon: Tool, equip: false },
];

const SPECIALTY_OF: Record<JobType, string> = {
  instalacao_com_equipamento: "instalacao", manutencao: "manutencao",
  remanejamento: "remanejamento", limpeza: "limpeza", conserto: "conserto",
};
const SPECIALTY_LABEL: Record<string, string> = {
  instalacao: "Instalação", manutencao: "Manutenção", remanejamento: "Remanejamento", limpeza: "Limpeza", conserto: "Conserto",
};

// Sintomas comuns por tipo de serviço — ajudam o cliente a descrever o problema.
const PROBLEMAS: Partial<Record<JobType, string[]>> = {
  manutencao: ["Não está gelando", "Gelando pouco", "Fazendo barulho", "Vazando água", "Cheiro ruim", "Revisão preventiva"],
  conserto: ["Não liga", "Desliga sozinho", "Não gela", "Barulho anormal", "Erro no display", "Suspeita de vazamento de gás"],
  limpeza: ["Higienização completa", "Mau cheiro", "Excesso de poeira", "Alergia / rinite", "Rotina periódica"],
  remanejamento: ["Mudar de parede", "Mudar de cômodo", "Mudança de endereço", "Reforma no ambiente"],
};
const URGENCIAS = ["Sem pressa", "Nos próximos dias", "Urgente (hoje / amanhã)"];

export function SolicitarWizard({ produtos, profissionais }: { produtos: ProdutoDTO[]; profissionais: ProfissionalDTO[] }) {
  const [jobType, setJobType] = useState<JobType | null>(null);
  const [step, setStep] = useState(0);

  // calculadora
  const [ambiente, setAmbiente] = useState("Sala");
  const [areaM2, setAreaM2] = useState(20);
  const [numPessoas, setNumPessoas] = useState(2);
  const [insolacaoAlta, setInsolacaoAlta] = useState(false);
  const [andarOuTelhado, setAndarOuTelhado] = useState(false);

  // serviço (não-instalação)
  const [problemas, setProblemas] = useState<string[]>([]);
  const [urgencia, setUrgencia] = useState<string>("");

  const [produtoId, setProdutoId] = useState<string | null>(null);
  const [profissionalId, setProfissionalId] = useState<string | null>(null);

  // endereço
  const [cep, setCep] = useState("");
  const [rua, setRua] = useState("");
  const [numero, setNumero] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidadeCep, setCidadeCep] = useState("");
  const [ufCep, setUfCep] = useState("");
  const [cepStatus, setCepStatus] = useState<"idle" | "buscando" | "ok" | "nao">("idle");
  const [descricao, setDescricao] = useState("");

  // geolocalização
  const [geo, setGeo] = useState<{ status: string; cidade?: string; uf?: string }>({ status: "idle" });

  // busca de profissional
  const [proBusca, setProBusca] = useState("");
  const [proSort, setProSort] = useState<"nota" | "servicos">("nota");

  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [sucessoId, setSucessoId] = useState<string | null>(null);

  const equip = jobType === "instalacao_com_equipamento";
  const specialty = jobType ? SPECIALTY_OF[jobType] : "instalacao";

  // pede a localização assim que o cliente entra no fluxo
  useEffect(() => {
    let vivo = true;
    setGeo({ status: "pedindo" });
    detectarLocalizacao().then((r) => {
      if (!vivo) return;
      if (r.status === "ok") setGeo({ status: "ok", cidade: r.cidade, uf: r.uf });
      else setGeo({ status: r.status });
    });
    return () => { vivo = false; };
  }, []);

  const btu = useMemo(
    () => calcularBtu({ areaM2, numPessoas, insolacaoAlta, andarOuTelhado }),
    [areaM2, numPessoas, insolacaoAlta, andarOuTelhado],
  );
  const produtosCompativeis = useMemo(() => produtos.filter((p) => p.btu === btu.btuRecomendado), [produtos, btu.btuRecomendado]);

  const prosOrdenados = useMemo(() => {
    const termo = proBusca.trim().toLowerCase();
    return profissionais
      .filter((p) => p.skills.some((s) => s.specialty === specialty))
      .filter((p) => !termo || p.nome.toLowerCase().includes(termo))
      .map((p) => ({ ...p, skill: p.skills.find((s) => s.specialty === specialty)!, patrocinado: p.destaqueEm.includes(specialty) }))
      .sort((a, b) => {
        if (a.patrocinado !== b.patrocinado) return a.patrocinado ? -1 : 1;
        return proSort === "servicos" ? b.skill.jobsCompleted - a.skill.jobsCompleted : b.skill.ratingAvg - a.skill.ratingAvg;
      });
  }, [profissionais, specialty, proBusca, proSort]);

  const steps: string[] = equip
    ? ["Serviço", "Ambiente", "Aparelho", "Profissional", "Endereço", "Confirmar"]
    : ["Serviço", "Detalhes", "Profissional", "Endereço", "Confirmar"];

  const produtoSel = produtos.find((p) => p.id === produtoId) ?? null;
  const proSel = prosOrdenados.find((p) => p.id === profissionalId) ?? profissionais.find((p) => p.id === profissionalId) ?? null;
  const precoServico = equip ? precoInstalacao(btu.btuRecomendado) : 0;
  const foraDaArea = cepStatus === "ok" && ufCep && ufCep !== ESTADO;

  function goTriagem(t: JobType) {
    setJobType(t); setProdutoId(null); setProfissionalId(null);
    setProblemas([]); setUrgencia(""); setStep(1);
  }
  function toggleProblema(p: string) {
    setProblemas((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);
  }
  async function aoDigitarCep(v: string) {
    const f = formatarCep(v);
    setCep(f);
    const dig = f.replace(/\D/g, "");
    if (dig.length === 8) {
      setCepStatus("buscando");
      const info = await buscarCep(dig);
      if (info) {
        setRua(info.logradouro); setBairro(info.bairro);
        setCidadeCep(info.cidade); setUfCep(info.uf); setCepStatus("ok");
      } else setCepStatus("nao");
    } else setCepStatus("idle");
  }

  function montarDescricao(): string {
    return [
      problemas.length ? `Problemas: ${problemas.join(", ")}` : "",
      urgencia ? `Urgência: ${urgencia}` : "",
      descricao.trim(),
    ].filter(Boolean).join(" · ");
  }
  function montarEndereco(): string {
    return [rua, numero].filter(Boolean).join(", ") + (bairro ? ` - ${bairro}` : "");
  }

  function confirmar() {
    if (!jobType || !profissionalId) return;
    setErro(null);
    startTransition(async () => {
      const res = await criarSolicitacao({
        jobType, cep, endereco: montarEndereco(),
        ambiente: equip ? ambiente : undefined,
        areaM2: equip ? areaM2 : undefined,
        numPessoas: equip ? numPessoas : undefined,
        insolacaoAlta: equip ? insolacaoAlta : undefined,
        andarOuTelhado: equip ? andarOuTelhado : undefined,
        btuRecomendado: equip ? btu.btuRecomendado : undefined,
        produtoId: equip ? produtoId : null,
        profissionalId,
        descricao: montarDescricao() || undefined,
      });
      if (res.ok) setSucessoId(res.jobId);
      else setErro(res.error);
    });
  }

  // ---------- SUCESSO ----------
  if (sucessoId) {
    return (
      <Shell geo={geo}>
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ display: "inline-grid", placeItems: "center", width: 64, height: 64, borderRadius: "50%", background: "var(--cool-wash)", color: "var(--cool-deep)" }}><CheckIcon size={32} /></div>
          <h1 style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-0.02em", margin: "16px 0 8px" }}>Solicitação enviada!</h1>
          <p style={{ color: "var(--ink-soft)", maxWidth: 420, margin: "0 auto 24px" }}>
            {proSel?.nome} recebeu seu pedido e vai confirmar em breve. Você acompanha tudo pelo painel.
          </p>
          <Link href="/painel" style={btnPrimary}>Ir para o painel</Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell geo={geo}>
      <Progress steps={steps} current={jobType ? step : 0} />

      {/* STEP 0 — TRIAGEM */}
      {step === 0 && (
        <>
          <H titulo="Do que você precisa?" sub="Escolha o serviço para começarmos." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 12 }}>
            {JOBS.map((j) => (
              <button key={j.tipo} onClick={() => goTriagem(j.tipo)} style={cardBtn}>
                <span style={{ display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 11, background: "var(--cool-wash)", color: "var(--cool-deep)" }}><j.Icon size={22} /></span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{j.titulo}</span>
                <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>{j.desc}</span>
                {j.equip && <span style={pill}>com aparelho</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {/* STEP CALCULADORA (equip) */}
      {step === 1 && equip && (
        <>
          <H titulo="Sobre o ambiente" sub="Calculamos a capacidade ideal (BTU) para você." />
          <div style={grid2}>
            <Campo label="Ambiente">
              <select value={ambiente} onChange={(e) => setAmbiente(e.target.value)} style={input}>
                {["Sala", "Quarto", "Cozinha", "Escritório", "Outro"].map((a) => <option key={a}>{a}</option>)}
              </select>
            </Campo>
            <Campo label={`Área: ${areaM2} m²`}>
              <input type="range" min={6} max={60} value={areaM2} onChange={(e) => setAreaM2(+e.target.value)} style={{ width: "100%" }} />
            </Campo>
            <Campo label={`Pessoas no ambiente: ${numPessoas}`}>
              <input type="range" min={1} max={10} value={numPessoas} onChange={(e) => setNumPessoas(+e.target.value)} style={{ width: "100%" }} />
            </Campo>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, justifyContent: "center" }}>
              <Check label="Ambiente pega muito sol" checked={insolacaoAlta} onChange={setInsolacaoAlta} />
              <Check label="Último andar / laje exposta" checked={andarOuTelhado} onChange={setAndarOuTelhado} />
            </div>
          </div>
          <div style={btuBox}>
            <div>
              <div style={{ fontSize: 12, fontFamily: mono, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Recomendado</div>
              <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "var(--cool-deep)" }}>{formatarBtu(btu.btuRecomendado)}</div>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-faint)", maxWidth: 220, textAlign: "right" }}>Cálculo assistivo. O profissional confirma na visita.</div>
          </div>
          <Nav onBack={() => setStep(0)} onNext={() => setStep(2)} nextLabel="Ver aparelhos" />
        </>
      )}

      {/* STEP CATÁLOGO (equip) */}
      {step === 2 && equip && (
        <>
          <H titulo={`Aparelhos de ${formatarBtu(btu.btuRecomendado)}`} sub="Da distribuidora, com entrega na sua casa." />
          {produtosCompativeis.length === 0 ? (
            <Aviso>Nenhum modelo dessa capacidade no catálogo agora. Volte e ajuste o ambiente.</Aviso>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px,1fr))", gap: 14 }}>
              {produtosCompativeis.map((p) => {
                const sel = p.id === produtoId;
                return (
                  <button key={p.id} onClick={() => setProdutoId(p.id)} style={{ ...prodCard, ...(sel ? prodCardSel : {}) }}>
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={p.modelo} style={{ width: "100%", height: 120, objectFit: "contain", background: "#fff", borderRadius: 8 }} />
                    ) : <div style={{ height: 120 }} />}
                    <span style={{ fontSize: 11, fontFamily: mono, color: "var(--cool)", textTransform: "uppercase" }}>{p.marca}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{p.modelo}</span>
                    <span style={{ fontSize: "1.05rem", fontWeight: 800 }}>{formatarBRL(p.precoVenda)}</span>
                  </button>
                );
              })}
            </div>
          )}
          <Nav onBack={() => setStep(1)} onNext={() => setStep(3)} nextLabel="Escolher profissional" disabled={!produtoId} />
        </>
      )}

      {/* STEP DETALHES (serviço) — descrição rica */}
      {step === 1 && !equip && (
        <>
          <H titulo="Conte o que está acontecendo" sub="Selecione o que se aplica e descreva com suas palavras." />
          <Campo label="Ambiente">
            <input value={ambiente} onChange={(e) => setAmbiente(e.target.value)} placeholder="Ex.: Quarto do casal" style={input} />
          </Campo>

          {PROBLEMAS[jobType!] && (
            <div style={{ marginBottom: 18 }}>
              <span style={labelTxt}>O que está acontecendo?</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {PROBLEMAS[jobType!]!.map((p) => {
                  const on = problemas.includes(p);
                  return (
                    <button key={p} type="button" onClick={() => toggleProblema(p)}
                      style={{ ...chip, ...(on ? chipOn : {}) }}>{p}</button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 18 }}>
            <span style={labelTxt}>Urgência</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {URGENCIAS.map((u) => (
                <button key={u} type="button" onClick={() => setUrgencia(u)} style={{ ...chip, ...(urgencia === u ? chipOn : {}) }}>{u}</button>
              ))}
            </div>
          </div>

          <Campo label="Detalhes (opcional)">
            <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Split 12k da marca X, tem uns 3 anos, começou a pingar água por dentro."
              rows={4} style={{ ...input, height: "auto", padding: 12, resize: "vertical" }} />
          </Campo>
          <Nav onBack={() => setStep(0)} onNext={() => setStep(2)} nextLabel="Escolher profissional" />
        </>
      )}

      {/* STEP PROFISSIONAL — com busca e ordenação */}
      {((equip && step === 3) || (!equip && step === 2)) && (
        <>
          <H titulo="Escolha o profissional" sub={`Avaliados em ${SPECIALTY_LABEL[specialty]} · ${CIDADE}`} />
          <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-faint)", display: "flex" }}><Search size={17} /></span>
              <input value={proBusca} onChange={(e) => setProBusca(e.target.value)} placeholder="Buscar por nome"
                style={{ ...input, paddingLeft: 38 }} />
            </div>
            <select value={proSort} onChange={(e) => setProSort(e.target.value as "nota" | "servicos")} style={{ ...input, width: "auto" }}>
              <option value="nota">Melhor avaliados</option>
              <option value="servicos">Mais serviços</option>
            </select>
          </div>

          {prosOrdenados.length === 0 ? (
            <Aviso>Nenhum profissional encontrado para “{SPECIALTY_LABEL[specialty]}” {proBusca ? "com esse nome" : `em ${CIDADE}`}.</Aviso>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {prosOrdenados.map((p) => {
                const sel = p.id === profissionalId;
                return (
                  <div key={p.id} onClick={() => setProfissionalId(p.id)} role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setProfissionalId(p.id); } }}
                    style={{ ...proCard, ...(sel ? proCardSel : {}) }}>
                    <div style={avatar}>{p.fotoUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.fotoUrl} alt={p.nome} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <span style={{ color: "var(--ink-faint)", display: "flex" }}>{p.tipo === "empresa" ? <Building size={22} /> : <User size={22} />}</span>}
                    </div>
                    <div style={{ flex: 1, textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700 }}>{p.nome}</span>
                        <span style={{ fontSize: 11, color: "var(--ink-faint)", fontFamily: mono }}>{p.tipo === "empresa" ? "Empresa" : "Autônomo"}</span>
                        {p.patrocinado && <span style={patroc}>Patrocinado</span>}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ color: "var(--warm)", display: "flex" }}><Star size={14} filled /></span>
                        <strong>{p.skill.ratingAvg.toFixed(1)}</strong>
                        <span style={{ color: "var(--ink-faint)" }}>({p.skill.ratingCount}) · {p.skill.jobsCompleted} serviços · {p.skill.yearsExperience} anos</span>
                      </div>
                      {p.bio && <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 4 }}>{p.bio}</div>}
                      <Link href={`/profissional/${p.id}`} target="_blank" onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: 12.5, color: "var(--cool-deep)", fontWeight: 600, marginTop: 6, display: "inline-block" }}>Ver perfil completo →</Link>
                    </div>
                    <div style={{ width: 22, textAlign: "center", color: sel ? "var(--cool)" : "var(--ink-faint)" }}>{sel ? "◉" : "○"}</div>
                  </div>
                );
              })}
            </div>
          )}
          <Nav onBack={() => setStep(equip ? 2 : 1)} onNext={() => setStep(equip ? 4 : 3)} nextLabel="Continuar" disabled={!profissionalId} />
        </>
      )}

      {/* STEP ENDEREÇO — com CEP automático */}
      {((equip && step === 4) || (!equip && step === 3)) && (
        <>
          <H titulo="Onde é o serviço?" sub="Digite o CEP que a gente preenche o resto." />
          <div style={grid2}>
            <Campo label="CEP">
              <input value={cep} onChange={(e) => aoDigitarCep(e.target.value)} inputMode="numeric" placeholder="00000-000" style={input} />
              {cepStatus === "buscando" && <span style={hint}>Buscando endereço…</span>}
              {cepStatus === "nao" && <span style={{ ...hint, color: "var(--warm)" }}>CEP não encontrado. Preencha manualmente.</span>}
              {cepStatus === "ok" && <span style={{ ...hint, color: "var(--good)" }}>{cidadeCep} — {ufCep}</span>}
            </Campo>
            <Campo label="Número"><input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="123" style={input} /></Campo>
          </div>
          <Campo label="Rua"><input value={rua} onChange={(e) => setRua(e.target.value)} placeholder="Rua / avenida" style={input} /></Campo>
          <Campo label="Bairro"><input value={bairro} onChange={(e) => setBairro(e.target.value)} placeholder="Bairro" style={input} /></Campo>
          {foraDaArea && <Aviso>Este CEP fica em {ufCep}. No momento atendemos {CIDADE} — {ESTADO}. Você pode continuar, mas talvez não haja profissionais na região.</Aviso>}
          <Nav onBack={() => setStep(equip ? 3 : 2)} onNext={() => setStep(equip ? 5 : 4)} nextLabel="Revisar" disabled={cep.replace(/\D/g, "").length !== 8 || !numero} />
        </>
      )}

      {/* STEP CONFIRMAR */}
      {((equip && step === 5) || (!equip && step === 4)) && (
        <>
          <H titulo="Confirme sua solicitação" sub="Revise antes de enviar." />
          <div style={resumo}>
            <LinhaResumo k="Serviço" v={JOBS.find((j) => j.tipo === jobType)!.titulo} />
            <LinhaResumo k="Profissional" v={proSel?.nome ?? "-"} />
            {equip && <LinhaResumo k="Ambiente" v={`${ambiente} · ${areaM2} m² · ${formatarBtu(btu.btuRecomendado)}`} />}
            {equip && produtoSel && <LinhaResumo k="Aparelho" v={produtoSel.modelo} />}
            {!equip && problemas.length > 0 && <LinhaResumo k="Problemas" v={problemas.join(", ")} />}
            {!equip && urgencia && <LinhaResumo k="Urgência" v={urgencia} />}
            <LinhaResumo k="Endereço" v={`${montarEndereco()} · ${cep}`} />
            {!equip && descricao && <LinhaResumo k="Detalhes" v={descricao} />}

            <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0", paddingTop: 10 }} />
            {equip && produtoSel && <LinhaResumo k="Aparelho" v={formatarBRL(produtoSel.precoVenda)} />}
            {equip && <LinhaResumo k="Instalação" v={formatarBRL(precoServico)} />}
            <LinhaResumo
              k={<strong>Total{equip ? "" : " (a combinar)"}</strong>}
              v={<strong>{equip && produtoSel ? formatarBRL(produtoSel.precoVenda + precoServico) : "Orçamento com o profissional"}</strong>}
            />
          </div>
          {erro && <Aviso erro>{erro}</Aviso>}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={() => setStep(equip ? 4 : 3)} style={btnGhost} disabled={pending}>Voltar</button>
            <button onClick={confirmar} style={{ ...btnPrimary, flex: 1, opacity: pending ? 0.7 : 1 }} disabled={pending}>
              {pending ? "Enviando..." : "Enviar solicitação"}
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

/* ---------- subcomponentes ---------- */
function Shell({ children, geo }: { children: React.ReactNode; geo: { status: string; cidade?: string; uf?: string } }) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 80px" }}>
      <Link href="/painel" style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-faint)", textDecoration: "none" }}>← Painel</Link>
      <GeoBanner geo={geo} />
      <div style={{ marginTop: 20 }}>{children}</div>
    </main>
  );
}

function GeoBanner({ geo }: { geo: { status: string; cidade?: string; uf?: string } }) {
  let texto: string, cor = "var(--ink-soft)", bg = "var(--surface-2)";
  if (geo.status === "pedindo") texto = "Detectando sua localização…";
  else if (geo.status === "ok") {
    const naArea = (geo.uf ?? "") === ESTADO;
    texto = naArea
      ? `Você está em ${geo.cidade || CIDADE}${geo.uf ? " — " + geo.uf : ""}. Atendemos sua região.`
      : `Você parece estar em ${geo.cidade || "outra região"}${geo.uf ? " — " + geo.uf : ""}. Atendemos ${CIDADE} — ${ESTADO}.`;
    cor = naArea ? "var(--cool-deep)" : "var(--warm)";
    bg = naArea ? "var(--cool-wash)" : "var(--warm-wash)";
  } else if (geo.status === "negado") texto = `Localização não permitida — sem problema, é só informar o CEP. Atendemos ${CIDADE} — ${ESTADO}.`;
  else if (geo.status === "idle") return null;
  else texto = `Atendemos ${CIDADE} — ${ESTADO}. Informe o CEP para confirmar a cobertura.`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, padding: "10px 14px", borderRadius: 10, background: bg, color: cor, fontSize: 13.5 }}>
      <MapPin size={16} /> {texto}
    </div>
  );
}

function Progress({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 28 }}>
      {steps.map((s, i) => (
        <span key={s} style={{
          fontFamily: mono, fontSize: 11.5, padding: "4px 10px", borderRadius: 100,
          background: i === current ? "var(--cool)" : i < current ? "var(--cool-wash)" : "var(--surface-2)",
          color: i === current ? "#fff" : i < current ? "var(--cool-deep)" : "var(--ink-faint)",
          border: "1px solid var(--line)",
        }}>{i + 1}. {s}</span>
      ))}
    </div>
  );
}
function H({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h1 style={{ fontSize: "1.55rem", fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 4px" }}>{titulo}</h1>
      <p style={{ color: "var(--ink-faint)", margin: 0 }}>{sub}</p>
    </div>
  );
}
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
      <span style={labelTxt}>{label}</span>
      {children}
    </label>
  );
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, color: "var(--ink-soft)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--cool)" }} />
      {label}
    </label>
  );
}
function Nav({ onBack, onNext, nextLabel, disabled }: { onBack: () => void; onNext: () => void; nextLabel: string; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
      <button onClick={onBack} style={btnGhost}>Voltar</button>
      <button onClick={onNext} disabled={disabled} style={{ ...btnPrimary, flex: 1, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>{nextLabel}</button>
    </div>
  );
}
function Aviso({ children, erro }: { children: React.ReactNode; erro?: boolean }) {
  return <div style={{ padding: "12px 16px", borderRadius: 10, background: erro ? "#fdeceb" : "var(--warm-wash)", color: erro ? "#b3261e" : "var(--warm)", fontSize: 14, marginTop: 12 }}>{children}</div>;
}
function LinhaResumo({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "6px 0", fontSize: 14 }}>
      <span style={{ color: "var(--ink-faint)" }}>{k}</span>
      <span style={{ textAlign: "right", color: "var(--ink)" }}>{v}</span>
    </div>
  );
}

/* ---------- estilos ---------- */
const grid2: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: "0 20px" };
const labelTxt: CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--ink-soft)" };
const input: CSSProperties = { height: 44, padding: "0 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: 15, width: "100%" };
const hint: CSSProperties = { fontSize: 12.5, color: "var(--ink-faint)", marginTop: 2 };
const cardBtn: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start", padding: 16, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", textAlign: "left" };
const pill: CSSProperties = { fontSize: 10.5, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 100, background: "var(--warm-wash)", color: "var(--warm)" };
const chip: CSSProperties = { padding: "8px 14px", borderRadius: 100, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink-soft)", fontSize: 13.5, fontWeight: 500, cursor: "pointer" };
const chipOn: CSSProperties = { border: "1px solid var(--cool)", background: "var(--cool-wash)", color: "var(--cool-deep)", fontWeight: 600 };
const btuBox: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginTop: 20, padding: "18px 22px", borderRadius: 14, background: "var(--cool-wash)", border: "1px solid var(--line)" };
const prodCard: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: 14, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", textAlign: "left" };
const prodCardSel: CSSProperties = { border: "1px solid var(--cool)", boxShadow: "inset 0 0 0 1px var(--cool)" };
const proCard: CSSProperties = { display: "flex", gap: 14, alignItems: "center", padding: 16, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", width: "100%" };
const proCardSel: CSSProperties = { border: "1px solid var(--cool)", boxShadow: "inset 0 0 0 1px var(--cool)" };
const avatar: CSSProperties = { width: 48, height: 48, borderRadius: "50%", overflow: "hidden", background: "var(--surface-2)", display: "grid", placeItems: "center", flexShrink: 0 };
const patroc: CSSProperties = { fontSize: 10.5, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.05em", padding: "2px 8px", borderRadius: 100, background: "var(--warm-wash)", color: "var(--warm)" };
const resumo: CSSProperties = { padding: "18px 22px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line)" };
const btnPrimary: CSSProperties = { height: 46, padding: "0 22px", borderRadius: 10, background: "var(--cool)", color: "#fff", fontWeight: 600, fontSize: 15, border: "none", cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" };
const btnGhost: CSSProperties = { height: 46, padding: "0 20px", borderRadius: 10, background: "var(--surface)", color: "var(--ink-soft)", fontWeight: 600, fontSize: 15, border: "1px solid var(--line)", cursor: "pointer" };
