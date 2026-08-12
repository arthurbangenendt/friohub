"use client";

import { useEffect, useMemo, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { calcularBtu, formatarBtu } from "@/lib/btu";
import { precoInstalacao, formatarBRL } from "@/lib/pricing";
import { buscarCep, detectarLocalizacao, formatarCep } from "@/lib/cep";
import { CIDADE, ESTADO } from "@/lib/regiao";
import { criarSolicitacao } from "./actions";
import { aceitaCatalogo, type JobType } from "./tipos";
import type { ProdutoDTO, ProfissionalDTO } from "./page";
import { Wind, Wrench, Droplet, Move, Tool, Check as CheckIcon, Star, Building, User, MapPin, Search } from "@/components/icons";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

type IconType = (p: { size?: number }) => React.ReactElement;
const JOBS: { tipo: JobType; titulo: string; desc: string; Icon: IconType; catalogo: boolean }[] = [
  { tipo: "instalacao_com_equipamento", titulo: "Instalar ar novo", desc: "Comprar o aparelho + instalação", Icon: Wind, catalogo: true },
  { tipo: "troca_equipamento", titulo: "Trocar equipamento", desc: "Substituir o aparelho antigo", Icon: Move, catalogo: true },
  { tipo: "manutencao", titulo: "Manutenção", desc: "Revisão, gás, não gela", Icon: Wrench, catalogo: false },
  { tipo: "limpeza", titulo: "Limpeza", desc: "Higienização completa", Icon: Droplet, catalogo: false },
  { tipo: "remanejamento", titulo: "Remanejamento", desc: "Mudar o aparelho de lugar", Icon: Move, catalogo: false },
  { tipo: "conserto", titulo: "Conserto", desc: "Reparo de defeito", Icon: Tool, catalogo: false },
  { tipo: "outros", titulo: "Outro serviço", desc: "Descreva o que você precisa", Icon: Tool, catalogo: false },
];

// `outros` não mapeia especialidade: é um balde genérico, então mostramos todos
// os profissionais em vez de filtrar por uma skill que não existe.
const SPECIALTY_OF: Record<JobType, string | null> = {
  instalacao_com_equipamento: "instalacao", troca_equipamento: "instalacao",
  manutencao: "manutencao", remanejamento: "remanejamento",
  limpeza: "limpeza", conserto: "conserto", outros: null,
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

const TIPOS_IMOVEL = ["Casa", "Apartamento", "Escritório", "Loja", "Galpão"];
const AMBIENTES = ["Sala", "Quarto", "Cozinha", "Escritório", "Loja", "Outro"];
const PERIODOS = ["Durante o dia", "À noite", "O dia inteiro"];

/* Passos são declarados por id, não por número. Com sete tipos de serviço e
   ramificações diferentes, indexar passo por `step === 3 && equip` é onde o bug
   nasce — aqui a lista é montada e a navegação anda sobre ela. */
type StepId = "servico" | "ambiente" | "detalhes" | "equipamento" | "catalogo" | "profissional" | "endereco" | "confirmar";
const STEP_LABEL: Record<StepId, string> = {
  servico: "Serviço", ambiente: "Ambiente", detalhes: "Detalhes", equipamento: "Aparelho",
  catalogo: "Escolher aparelho", profissional: "Profissional", endereco: "Endereço", confirmar: "Confirmar",
};

function montarSteps(jobType: JobType | null, jaTemEquipamento: boolean | null): StepId[] {
  if (!jobType) return ["servico"];
  const fim: StepId[] = ["profissional", "endereco", "confirmar"];
  if (aceitaCatalogo(jobType)) {
    // O catálogo só entra quando o cliente diz que ainda não tem o aparelho.
    return ["servico", "ambiente", "equipamento", ...(jaTemEquipamento === false ? ["catalogo" as StepId] : []), ...fim];
  }
  return ["servico", "detalhes", ...fim];
}

export function SolicitarWizard({
  produtos, profissionais, cepInicial = "",
}: {
  produtos: ProdutoDTO[];
  profissionais: ProfissionalDTO[];
  cepInicial?: string;
}) {
  const [jobType, setJobType] = useState<JobType | null>(null);
  const [idx, setIdx] = useState(0);

  // calculadora
  const [tipoImovel, setTipoImovel] = useState("Apartamento");
  const [ambiente, setAmbiente] = useState("Sala");
  const [areaM2, setAreaM2] = useState(20);
  const [numPessoas, setNumPessoas] = useState(2);
  const [eletronicos, setEletronicos] = useState(1);
  const [periodo, setPeriodo] = useState(PERIODOS[0]);
  const [insolacaoAlta, setInsolacaoAlta] = useState(false);
  const [andarOuTelhado, setAndarOuTelhado] = useState(false);

  // já tem equipamento?
  const [jaTemEquipamento, setJaTemEquipamento] = useState<boolean | null>(null);

  // serviço (não-catálogo)
  const [problemas, setProblemas] = useState<string[]>([]);
  const [urgencia, setUrgencia] = useState<string>("");
  const [servicoOutro, setServicoOutro] = useState("");

  const [produtoId, setProdutoId] = useState<string | null>(null);
  const [filtroDistribuidora, setFiltroDistribuidora] = useState("todas");
  const [profissionalId, setProfissionalId] = useState<string | null>(null);

  // endereço — o CEP pode chegar já preenchido pelo hero da home
  const [cep, setCep] = useState(() => formatarCep(cepInicial));
  const [rua, setRua] = useState("");
  const [numero, setNumero] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidadeCep, setCidadeCep] = useState("");
  const [ufCep, setUfCep] = useState("");
  // já entra em "buscando" quando o CEP veio da home — o efeito abaixo resolve
  const [cepStatus, setCepStatus] = useState<"idle" | "buscando" | "ok" | "nao">(
    () => (cepInicial.replace(/\D/g, "").length === 8 ? "buscando" : "idle"),
  );
  const [descricao, setDescricao] = useState("");

  // geolocalização
  const [geo, setGeo] = useState<{ status: string; cidade?: string; uf?: string }>({ status: "pedindo" });

  // busca de profissional
  const [proBusca, setProBusca] = useState("");
  const [proSort, setProSort] = useState<"nota" | "servicos">("nota");

  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [sucessoId, setSucessoId] = useState<string | null>(null);

  const comCatalogo = jobType ? aceitaCatalogo(jobType) : false;
  const specialty = jobType ? SPECIALTY_OF[jobType] : null;

  const steps = useMemo(() => montarSteps(jobType, jaTemEquipamento), [jobType, jaTemEquipamento]);
  const stepAtual = steps[Math.min(idx, steps.length - 1)];

  // pede a localização assim que o cliente entra no fluxo
  useEffect(() => {
    let vivo = true;
    detectarLocalizacao().then((r) => {
      if (!vivo) return;
      if (r.status === "ok") setGeo({ status: "ok", cidade: r.cidade, uf: r.uf });
      else setGeo({ status: r.status });
    });
    return () => { vivo = false; };
  }, []);

  // CEP vindo da home já chega resolvido, sem o cliente digitar de novo
  useEffect(() => {
    const dig = cepInicial.replace(/\D/g, "");
    if (dig.length !== 8) return;
    let vivo = true;
    buscarCep(dig).then((info) => {
      if (!vivo) return;
      if (info) {
        setRua(info.logradouro); setBairro(info.bairro);
        setCidadeCep(info.cidade); setUfCep(info.uf); setCepStatus("ok");
      } else setCepStatus("nao");
    });
    return () => { vivo = false; };
  }, [cepInicial]);

  const btu = useMemo(
    () => calcularBtu({ areaM2, numPessoas, insolacaoAlta, andarOuTelhado, eletronicos }),
    [areaM2, numPessoas, insolacaoAlta, andarOuTelhado, eletronicos],
  );

  const distribuidoras = useMemo(() => {
    const s = new Set<string>();
    for (const p of produtos) if (p.distribuidora) s.add(p.distribuidora);
    return [...s].sort();
  }, [produtos]);

  /* O catálogo mostra TODOS os aparelhos para o cliente comparar preço, mas os
     compatíveis com o BTU calculado vêm primeiro e marcados. Antes filtrávamos
     só pelo BTU exato, o que deixava a tela vazia sempre que o catálogo não
     tinha aquela capacidade. */
  const produtosOrdenados = useMemo(() => {
    return produtos
      .filter((p) => filtroDistribuidora === "todas" || p.distribuidora === filtroDistribuidora)
      .map((p) => ({ ...p, recomendado: p.btu === btu.btuRecomendado }))
      .sort((a, b) => {
        if (a.recomendado !== b.recomendado) return a.recomendado ? -1 : 1;
        // fora os recomendados, o mais perto da capacidade ideal primeiro
        const da = Math.abs(a.btu - btu.btuRecomendado), db = Math.abs(b.btu - btu.btuRecomendado);
        return da !== db ? da - db : a.precoVenda - b.precoVenda;
      });
  }, [produtos, filtroDistribuidora, btu.btuRecomendado]);

  const qtdRecomendados = produtosOrdenados.filter((p) => p.recomendado).length;

  const prosOrdenados = useMemo(() => {
    const termo = proBusca.trim().toLowerCase();
    return profissionais
      .filter((p) => !specialty || p.skills.some((s) => s.specialty === specialty))
      .filter((p) => !termo || p.nome.toLowerCase().includes(termo))
      .map((p) => {
        // sem especialidade (tipo "outros"), usa a skill mais forte do profissional
        const skill = specialty
          ? p.skills.find((s) => s.specialty === specialty)!
          : [...p.skills].sort((a, b) => b.ratingAvg - a.ratingAvg)[0];
        return { ...p, skill, patrocinado: specialty ? p.destaqueEm.includes(specialty) : false };
      })
      .filter((p) => p.skill)
      .sort((a, b) => {
        if (a.patrocinado !== b.patrocinado) return a.patrocinado ? -1 : 1;
        return proSort === "servicos" ? b.skill.jobsCompleted - a.skill.jobsCompleted : b.skill.ratingAvg - a.skill.ratingAvg;
      });
  }, [profissionais, specialty, proBusca, proSort]);

  const produtoSel = produtos.find((p) => p.id === produtoId) ?? null;
  const proSel = prosOrdenados.find((p) => p.id === profissionalId) ?? profissionais.find((p) => p.id === profissionalId) ?? null;
  const precoServico = comCatalogo ? precoInstalacao(btu.btuRecomendado) : 0;
  const foraDaArea = cepStatus === "ok" && ufCep && ufCep !== ESTADO;

  function goTriagem(t: JobType) {
    setJobType(t); setProdutoId(null); setProfissionalId(null);
    setProblemas([]); setUrgencia(""); setServicoOutro(""); setJaTemEquipamento(null);
    setIdx(1);
  }
  function avancar() { setIdx((i) => Math.min(i + 1, steps.length - 1)); }
  function voltar() {
    if (idx <= 1) { setIdx(0); setJobType(null); return; }
    setIdx((i) => i - 1);
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
      servicoOutro.trim() ? `Serviço: ${servicoOutro.trim()}` : "",
      comCatalogo ? `Imóvel: ${tipoImovel} · Uso: ${periodo}` : "",
      jaTemEquipamento === true ? "Cliente já tem o equipamento" : "",
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
        ambiente: comCatalogo ? ambiente : undefined,
        areaM2: comCatalogo ? areaM2 : undefined,
        numPessoas: comCatalogo ? numPessoas : undefined,
        insolacaoAlta: comCatalogo ? insolacaoAlta : undefined,
        andarOuTelhado: comCatalogo ? andarOuTelhado : undefined,
        btuRecomendado: comCatalogo ? btu.btuRecomendado : undefined,
        produtoId: comCatalogo ? produtoId : null,
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
      <Progress steps={steps} current={idx} />

      {/* ---------- TRIAGEM ---------- */}
      {stepAtual === "servico" && (
        <>
          <H titulo="Do que você precisa?" sub="Escolha o serviço para começarmos." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 12 }}>
            {JOBS.map((j) => (
              <button key={j.tipo} onClick={() => goTriagem(j.tipo)} style={cardBtn}>
                <span style={{ display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 11, background: "var(--cool-wash)", color: "var(--cool-deep)" }}><j.Icon size={22} /></span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{j.titulo}</span>
                <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>{j.desc}</span>
                {j.catalogo && <span style={pill}>aparelho disponível</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ---------- AMBIENTE (tipos com catálogo) ---------- */}
      {stepAtual === "ambiente" && (
        <>
          <H titulo="Sobre o ambiente" sub="Cada resposta refina o cálculo de capacidade ao lado." />
          <div style={grid2}>
            <Campo label="Tipo de imóvel">
              <select value={tipoImovel} onChange={(e) => setTipoImovel(e.target.value)} style={input}>
                {TIPOS_IMOVEL.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Campo>
            <Campo label="Cômodo">
              <select value={ambiente} onChange={(e) => setAmbiente(e.target.value)} style={input}>
                {AMBIENTES.map((a) => <option key={a}>{a}</option>)}
              </select>
            </Campo>
            <Campo label={`Área: ${areaM2} m²`}>
              <input type="range" min={6} max={120} value={areaM2} onChange={(e) => setAreaM2(+e.target.value)} style={{ width: "100%" }} />
            </Campo>
            <Campo label={`Pessoas no ambiente: ${numPessoas}`}>
              <input type="range" min={1} max={20} value={numPessoas} onChange={(e) => setNumPessoas(+e.target.value)} style={{ width: "100%" }} />
            </Campo>
            <Campo label={`Eletrônicos que esquentam: ${eletronicos}`}>
              <input type="range" min={0} max={10} value={eletronicos} onChange={(e) => setEletronicos(+e.target.value)} style={{ width: "100%" }} />
              <span style={hint}>TV, computador, forno, geladeira no mesmo ambiente.</span>
            </Campo>
            <Campo label="Uso principal">
              <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={input}>
                {PERIODOS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Campo>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "4px 0 4px" }}>
            <Check label="O ambiente pega muito sol" checked={insolacaoAlta} onChange={setInsolacaoAlta} />
            <Check label="Último andar / laje exposta" checked={andarOuTelhado} onChange={setAndarOuTelhado} />
          </div>

          <AnaliseBtu btu={btu} />
          <Nav onBack={voltar} onNext={avancar} nextLabel="Continuar" />
        </>
      )}

      {/* ---------- JÁ TEM EQUIPAMENTO? ---------- */}
      {stepAtual === "equipamento" && (
        <>
          <H titulo="Você já tem o aparelho?" sub="Se ainda não tiver, mostramos as opções das distribuidoras parceiras." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 12 }}>
            <EscolhaGrande
              titulo="Já tenho o aparelho"
              desc="Só preciso do serviço de instalação."
              ativo={jaTemEquipamento === true}
              onClick={() => setJaTemEquipamento(true)}
            />
            <EscolhaGrande
              titulo="Ainda não tenho"
              desc="Quero ver aparelhos e comparar preços."
              ativo={jaTemEquipamento === false}
              onClick={() => setJaTemEquipamento(false)}
            />
          </div>
          {jaTemEquipamento === true && (
            <div style={{ marginTop: 18 }}>
              <Campo label="Qual aparelho você tem? (opcional)">
                <input value={descricao} onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Ex.: Split 12.000 BTU marca X, comprado há 2 anos" style={input} />
              </Campo>
              <div style={{ ...avisoBox, background: "var(--cool-wash)", color: "var(--cool-deep)" }}>
                Pela sua descrição do ambiente, a capacidade indicada é <strong>{formatarBtu(btu.btuRecomendado)}</strong>.
                O profissional confirma na visita se o seu aparelho atende.
              </div>
            </div>
          )}
          <Nav onBack={voltar} onNext={avancar} nextLabel="Continuar" disabled={jaTemEquipamento === null} />
        </>
      )}

      {/* ---------- CATÁLOGO ---------- */}
      {stepAtual === "catalogo" && (
        <>
          <H titulo="Escolha o aparelho"
            sub={qtdRecomendados > 0
              ? `${qtdRecomendados} modelo(s) na capacidade ideal de ${formatarBtu(btu.btuRecomendado)} — aparecem primeiro.`
              : `Nenhum modelo exatamente de ${formatarBtu(btu.btuRecomendado)}. Listamos do mais próximo ao mais distante.`} />

          {distribuidoras.length > 1 && (
            <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
              <span style={labelTxt}>Distribuidora</span>
              <select value={filtroDistribuidora} onChange={(e) => setFiltroDistribuidora(e.target.value)} style={{ ...input, width: "auto" }}>
                <option value="todas">Todas</option>
                {distribuidoras.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}

          {produtosOrdenados.length === 0 ? (
            <Aviso>Nenhum aparelho disponível no catálogo com esse filtro.</Aviso>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px,1fr))", gap: 14 }}>
              {produtosOrdenados.map((p) => {
                const sel = p.id === produtoId;
                return (
                  <button key={p.id} onClick={() => setProdutoId(p.id)} style={{ ...prodCard, ...(sel ? prodCardSel : {}) }}>
                    {p.recomendado && <span style={badgeRec}>Ideal para seu ambiente</span>}
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={p.modelo} style={{ width: "100%", height: 120, objectFit: "contain", background: "#fff", borderRadius: 8 }} />
                    ) : <div style={{ height: 120 }} />}
                    <span style={{ fontSize: 11, fontFamily: mono, color: "var(--cool)", textTransform: "uppercase" }}>{p.marca}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{p.modelo}</span>
                    <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{formatarBtu(p.btu)}</span>
                    <span style={{ fontSize: "1.05rem", fontWeight: 800 }}>{formatarBRL(p.precoVenda)}</span>
                    <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
                      {p.distribuidora ? `Distribuidora: ${p.distribuidora}` : "Distribuidora não informada"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <Nav onBack={voltar} onNext={avancar} nextLabel="Escolher profissional" disabled={!produtoId} />
        </>
      )}

      {/* ---------- DETALHES (serviço sem catálogo) ---------- */}
      {stepAtual === "detalhes" && (
        <>
          <H titulo={jobType === "outros" ? "O que você precisa?" : "Conte o que está acontecendo"}
            sub={jobType === "outros" ? "Descreva com suas palavras — encaminhamos ao profissional certo." : "Selecione o que se aplica e descreva com suas palavras."} />

          {jobType === "outros" && (
            <Campo label="Descreva o serviço">
              <textarea value={servicoOutro} onChange={(e) => setServicoOutro(e.target.value)}
                placeholder="Ex.: Preciso de um laudo técnico do sistema de climatização da loja."
                rows={4} style={{ ...input, height: "auto", padding: 12, resize: "vertical" }} />
            </Campo>
          )}

          {jobType !== "outros" && (
            <Campo label="Ambiente">
              <input value={ambiente} onChange={(e) => setAmbiente(e.target.value)} placeholder="Ex.: Quarto do casal" style={input} />
            </Campo>
          )}

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
          <Nav onBack={voltar} onNext={avancar} nextLabel="Escolher profissional"
            disabled={jobType === "outros" && servicoOutro.trim().length < 10} />
        </>
      )}

      {/* ---------- PROFISSIONAL ---------- */}
      {stepAtual === "profissional" && (
        <>
          <H titulo="Escolha o profissional"
            sub={specialty ? `Avaliados em ${SPECIALTY_LABEL[specialty]} · ${CIDADE}` : `Profissionais verificados em ${CIDADE}`} />
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
            <Aviso>Nenhum profissional encontrado{specialty ? ` para “${SPECIALTY_LABEL[specialty]}”` : ""} {proBusca ? "com esse nome" : `em ${CIDADE}`}.</Aviso>
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
          <Nav onBack={voltar} onNext={avancar} nextLabel="Continuar" disabled={!profissionalId} />
        </>
      )}

      {/* ---------- ENDEREÇO ---------- */}
      {stepAtual === "endereco" && (
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
          <Nav onBack={voltar} onNext={avancar} nextLabel="Revisar" disabled={cep.replace(/\D/g, "").length !== 8 || !numero} />
        </>
      )}

      {/* ---------- CONFIRMAR ---------- */}
      {stepAtual === "confirmar" && (
        <>
          <H titulo="Confirme sua solicitação" sub="Revise antes de enviar." />
          <div style={resumo}>
            <LinhaResumo k="Serviço" v={JOBS.find((j) => j.tipo === jobType)!.titulo} />
            {jobType === "outros" && servicoOutro && <LinhaResumo k="Descrição" v={servicoOutro} />}
            <LinhaResumo k="Profissional" v={proSel?.nome ?? "-"} />
            {comCatalogo && <LinhaResumo k="Ambiente" v={`${tipoImovel} · ${ambiente} · ${areaM2} m² · ${formatarBtu(btu.btuRecomendado)}`} />}
            {comCatalogo && jaTemEquipamento === true && <LinhaResumo k="Aparelho" v="Cliente já possui" />}
            {produtoSel && <LinhaResumo k="Aparelho" v={`${produtoSel.modelo}${produtoSel.distribuidora ? ` · ${produtoSel.distribuidora}` : ""}`} />}
            {!comCatalogo && problemas.length > 0 && <LinhaResumo k="Problemas" v={problemas.join(", ")} />}
            {urgencia && <LinhaResumo k="Urgência" v={urgencia} />}
            <LinhaResumo k="Endereço" v={`${montarEndereco()} · ${cep}`} />
            {descricao && <LinhaResumo k="Detalhes" v={descricao} />}

            <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0", paddingTop: 10 }} />
            {produtoSel && <LinhaResumo k="Aparelho" v={formatarBRL(produtoSel.precoVenda)} />}
            {comCatalogo && <LinhaResumo k="Instalação" v={formatarBRL(precoServico)} />}
            <LinhaResumo
              k={<strong>Total{produtoSel ? "" : " (a combinar)"}</strong>}
              v={<strong>{produtoSel ? formatarBRL(produtoSel.precoVenda + precoServico) : "Orçamento com o profissional"}</strong>}
            />
          </div>
          {erro && <Aviso erro>{erro}</Aviso>}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={voltar} style={btnGhost} disabled={pending}>Voltar</button>
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

// Painel de análise ao vivo: mostra COMO a capacidade foi calculada, em vez de
// só cuspir o número. `btu.detalhe` já existia em lib/btu e não era exibido.
function AnaliseBtu({ btu }: { btu: ReturnType<typeof calcularBtu> }) {
  return (
    <div style={btuBox}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontFamily: mono, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Capacidade recomendada</div>
          <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "var(--cool-deep)" }}>{formatarBtu(btu.btuRecomendado)}</div>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-faint)", maxWidth: 220, textAlign: "right" }}>
          Cálculo assistivo. O profissional confirma na visita.
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 12, display: "flex", flexDirection: "column", gap: 5 }}>
        {btu.detalhe.map((d) => (
          <div key={d.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--ink-soft)" }}>
            <span>{d.label}</span>
            <span style={{ fontFamily: mono }}>+{d.valor.toLocaleString("pt-BR")}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700, color: "var(--ink)", marginTop: 3 }}>
          <span>Carga térmica estimada</span>
          <span style={{ fontFamily: mono }}>{btu.btuCalculado.toLocaleString("pt-BR")} BTU/h</span>
        </div>
      </div>
    </div>
  );
}

function EscolhaGrande({ titulo, desc, ativo, onClick }: { titulo: string; desc: string; ativo: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...cardBtn, ...(ativo ? prodCardSel : {}), gap: 4 }}>
      <span style={{ fontWeight: 700, fontSize: 15.5 }}>{titulo}</span>
      <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>{desc}</span>
    </button>
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

function Progress({ steps, current }: { steps: StepId[]; current: number }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 28 }}>
      {steps.map((s, i) => (
        <span key={s} style={{
          fontFamily: mono, fontSize: 11.5, padding: "4px 10px", borderRadius: 100,
          background: i === current ? "var(--cool)" : i < current ? "var(--cool-wash)" : "var(--surface-2)",
          color: i === current ? "#fff" : i < current ? "var(--cool-deep)" : "var(--ink-faint)",
          border: "1px solid var(--line)",
        }}>{i + 1}. {STEP_LABEL[s]}</span>
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
  return <div style={{ ...avisoBox, background: erro ? "#fdeceb" : "var(--warm-wash)", color: erro ? "#b3261e" : "var(--warm)" }}>{children}</div>;
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
const avisoBox: CSSProperties = { padding: "12px 16px", borderRadius: 10, fontSize: 14, marginTop: 12 };
const cardBtn: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start", padding: 16, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", textAlign: "left" };
const pill: CSSProperties = { fontSize: 10.5, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 100, background: "var(--warm-wash)", color: "var(--warm)" };
const chip: CSSProperties = { padding: "8px 14px", borderRadius: 100, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink-soft)", fontSize: 13.5, fontWeight: 500, cursor: "pointer" };
const chipOn: CSSProperties = { border: "1px solid var(--cool)", background: "var(--cool-wash)", color: "var(--cool-deep)", fontWeight: 600 };
const btuBox: CSSProperties = { marginTop: 20, padding: "18px 22px", borderRadius: 14, background: "var(--cool-wash)", border: "1px solid var(--line)" };
const prodCard: CSSProperties = { position: "relative", display: "flex", flexDirection: "column", gap: 6, padding: 14, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", textAlign: "left" };
const prodCardSel: CSSProperties = { border: "1px solid var(--cool)", boxShadow: "inset 0 0 0 1px var(--cool)" };
const badgeRec: CSSProperties = { position: "absolute", top: 10, right: 10, fontSize: 10, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 100, background: "var(--cool)", color: "#fff" };
const proCard: CSSProperties = { display: "flex", gap: 14, alignItems: "center", padding: 16, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", width: "100%" };
const proCardSel: CSSProperties = { border: "1px solid var(--cool)", boxShadow: "inset 0 0 0 1px var(--cool)" };
const avatar: CSSProperties = { width: 48, height: 48, borderRadius: "50%", overflow: "hidden", background: "var(--surface-2)", display: "grid", placeItems: "center", flexShrink: 0 };
const patroc: CSSProperties = { fontSize: 10.5, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.05em", padding: "2px 8px", borderRadius: 100, background: "var(--warm-wash)", color: "var(--warm)" };
const resumo: CSSProperties = { padding: "18px 22px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line)" };
const btnPrimary: CSSProperties = { height: 46, padding: "0 22px", borderRadius: 10, background: "var(--cool)", color: "#fff", fontWeight: 600, fontSize: 15, border: "none", cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" };
const btnGhost: CSSProperties = { height: 46, padding: "0 20px", borderRadius: 10, background: "var(--surface)", color: "var(--ink-soft)", fontWeight: 600, fontSize: 15, border: "1px solid var(--line)", cursor: "pointer" };
