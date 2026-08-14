"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { calcularBtu, formatarBtu } from "@/lib/btu";
import { precoInstalacao, formatarBRL } from "@/lib/pricing";
import { buscarCep, detectarLocalizacaoDetalhada, formatarCep } from "@/lib/cep";
import { CIDADE, ESTADO } from "@/lib/regiao";
import { criarPedidoOrcamento } from "@/app/painel/orcamentos/actions";
import { MAX_DESTINATARIOS } from "@/app/painel/orcamentos/config";
import { FotosPedido, type FotoPendente } from "./FotosPedido";
import { aceitaCatalogo, type JobType } from "./tipos";
import type { PaginaMarketplace, ProdutoDTO, ProfissionalDTO } from "./marketplace-types";
import { Wind, Wrench, Droplet, Move, Tool, Check as CheckIcon, Star, Building, User, MapPin, Search } from "@/components/icons";
import { corDoId, iniciais } from "../painel/Avatar";
import { ANALYTICS_VERSION, captureAnalytics } from "@/lib/analytics";

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
// Rótulo exibido → valor aceito pelo CHECK de `quote_requests.urgencia`.
const URGENCIA_ID: Record<string, "sem_pressa" | "proximos_dias" | "urgente" | undefined> = {
  "Sem pressa": "sem_pressa",
  "Nos próximos dias": "proximos_dias",
  "Urgente (hoje / amanhã)": "urgente",
};

const TIPOS_IMOVEL = ["Casa", "Apartamento", "Escritório", "Loja", "Galpão"];
const AMBIENTES = ["Sala", "Quarto", "Cozinha", "Escritório", "Loja", "Outro"];
const PERIODOS = ["Durante o dia", "À noite", "O dia inteiro"];

async function carregarPagina<T>(params: URLSearchParams, signal?: AbortSignal) {
  const response = await fetch(`/api/marketplace/catalogo?${params}`, { signal });
  const body = await response.json() as PaginaMarketplace<T> | { error?: string };
  if (!response.ok || !("items" in body)) {
    throw new Error("error" in body && body.error ? body.error : "Não foi possível carregar os resultados.");
  }
  return body;
}

type CoordenadasServico = { latitude: number; longitude: number };

async function carregarProfissionaisPagina(
  input: {
    page: number;
    cep: string;
    specialty: string | null;
    sort: string;
    q: string;
    coordenadas: CoordenadasServico | null;
  },
  signal?: AbortSignal,
) {
  const response = await fetch("/api/marketplace/catalogo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      page: input.page,
      cep: input.cep,
      specialty: input.specialty,
      sort: input.sort,
      q: input.q,
      latitude: input.coordenadas?.latitude,
      longitude: input.coordenadas?.longitude,
    }),
    signal,
  });
  const body = await response.json() as PaginaMarketplace<ProfissionalDTO> | { error?: string };
  if (!response.ok || !("items" in body)) {
    throw new Error("error" in body && body.error ? body.error : "Não foi possível carregar os profissionais.");
  }
  return body;
}

type GeoState = {
  status: "pedindo" | "coordenadas" | "ok" | "negado" | "erro" | "indisponivel" | "idle";
  cidade?: string;
  uf?: string;
  cep?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number | null;
};

/* Passos são declarados por id, não por número. Com sete tipos de serviço e
   ramificações diferentes, indexar passo por `step === 3 && equip` é onde o bug
   nasce — aqui a lista é montada e a navegação anda sobre ela. */
type StepId = "servico" | "ambiente" | "detalhes" | "equipamento" | "catalogo" | "profissional" | "endereco" | "confirmar";
const STEP_LABEL: Record<StepId, string> = {
  servico: "Serviço", ambiente: "Ambiente", detalhes: "Detalhes", equipamento: "Aparelho",
  catalogo: "Escolher aparelho", endereco: "Região", profissional: "Profissionais",
  confirmar: "Enviar",
};

/* Este wizard é TRIAGEM, e só isso: descobrir o aparelho certo e quais
 * profissionais atendem a região. Nada aqui pode repetir pergunta nem cobrar
 * esforço técnico do cliente.
 *
 * O questionário técnico (metragem de linha frigorígena, tipo de parede, acesso,
 * elétrica) NÃO vive aqui — ele aparece só quando o cliente decide fechar com um
 * profissional, na tela de aceite da proposta. Ver `Propostas.tsx`.
 *
 * Consequência assumida: sem essas respostas no pedido, o profissional tende a
 * responder propondo VISITA TÉCNICA em vez de preço fechado. É por isso que a
 * proposta tem os dois formatos.
 */
function montarSteps(jobType: JobType | null, jaTemEquipamento: boolean | null): StepId[] {
  if (!jobType) return ["servico"];
  const fim: StepId[] = ["endereco", "profissional", "confirmar"];
  if (aceitaCatalogo(jobType)) {
    // O catálogo só entra quando o cliente diz que ainda não tem o aparelho.
    return [
      "servico", "ambiente", "equipamento",
      ...(jaTemEquipamento === false ? ["catalogo" as StepId] : []),
      ...fim,
    ];
  }
  return ["servico", "detalhes", ...fim];
}

export function SolicitarWizard({
  produtos, totalProdutos, profissionais, cepInicial = "", userId, equipmentInitial,
}: {
  produtos: ProdutoDTO[];
  totalProdutos: number;
  profissionais: ProfissionalDTO[];
  cepInicial?: string;
  equipmentInitial?: { id: string; label: string; brand: string | null; model: string | null; capacityBtu: number | null } | null;
  /** Dono do upload: as policies do bucket exigem a pasta {uid}/. */
  userId: string;
}) {
  const [jobType, setJobType] = useState<JobType | null>(() => equipmentInitial ? "manutencao" : null);
  const [idx, setIdx] = useState(() => equipmentInitial ? 1 : 0);

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
  const [jaTemEquipamento, setJaTemEquipamento] = useState<boolean | null>(() => equipmentInitial ? true : null);

  // serviço (não-catálogo)
  const [problemas, setProblemas] = useState<string[]>([]);
  const [urgencia, setUrgencia] = useState<string>("");
  const [servicoOutro, setServicoOutro] = useState("");

  const [produtoId, setProdutoId] = useState<string | null>(null);
  const [produtoSelecionado, setProdutoSelecionado] = useState<ProdutoDTO | null>(null);
  const [produtosLista, setProdutosLista] = useState(produtos);
  const [produtosTotal, setProdutosTotal] = useState(totalProdutos);
  const [produtosPagina, setProdutosPagina] = useState(1);
  const [produtoBusca, setProdutoBusca] = useState("");
  const [produtosCarregando, setProdutosCarregando] = useState(false);
  /* Multi-cotação: o cliente descreve uma vez e envia para vários. É o padrão do
     mercado, e é o que faz a rede responder — quem demora, perde o serviço. */
  const [profissionaisLista, setProfissionaisLista] = useState(profissionais);
  const [profissionaisTotal, setProfissionaisTotal] = useState(profissionais.length);
  const [profissionaisPagina, setProfissionaisPagina] = useState(1);
  const [profissionaisSelecionados, setProfissionaisSelecionados] = useState<ProfissionalDTO[]>([]);
  const [chaveSelecao, setChaveSelecao] = useState("");
  const [profissionaisCarregando, setProfissionaisCarregando] = useState(false);
  const [fotos, setFotos] = useState<FotoPendente[]>([]);
  const [quantidade, setQuantidade] = useState(1);

  // endereço — o CEP pode chegar já preenchido pelo hero da home
  const [cep, setCep] = useState(() => formatarCep(cepInicial));
  /* Rua e número não são mais coletados no pedido de orçamento — só o CEP e o
     bairro. O endereço completo é informado na hora de aceitar uma proposta. */
  const [bairro, setBairro] = useState("");
  const [cidadeCep, setCidadeCep] = useState("");
  const [ufCep, setUfCep] = useState("");
  // já entra em "buscando" quando o CEP veio da home — o efeito abaixo resolve
  const [cepStatus, setCepStatus] = useState<"idle" | "buscando" | "ok" | "nao">(
    () => (cepInicial.replace(/\D/g, "").length === 8 ? "buscando" : "idle"),
  );
  const [descricao, setDescricao] = useState(() => equipmentInitial ? `Atendimento para ${[equipmentInitial.brand, equipmentInitial.model].filter(Boolean).join(" ") || "equipamento"} em ${equipmentInitial.label}.` : "");

  // geolocalização
  const [geo, setGeo] = useState<GeoState>({ status: "pedindo" });
  const [cepConfirmadoGps, setCepConfirmadoGps] = useState<string | null>(null);
  const cepRequestId = useRef(0);

  // busca de profissional
  const [proBusca, setProBusca] = useState("");
  const [proSort, setProSort] = useState<"relevancia" | "nota" | "servicos" | "resposta" | "disponibilidade">("relevancia");
  const [buscaErro, setBuscaErro] = useState<string | null>(null);

  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [sucessoId, setSucessoId] = useState<string | null>(null);
  const [enviados, setEnviados] = useState(0);

  const comCatalogo = jobType ? aceitaCatalogo(jobType) : false;
  const specialty = jobType ? SPECIALTY_OF[jobType] : null;

  const steps = useMemo(() => montarSteps(jobType, jaTemEquipamento), [jobType, jaTemEquipamento]);
  const stepAtual = steps[Math.min(idx, steps.length - 1)];

  const cepDigitos = cep.replace(/\D/g, "");
  const geoCepDigitos = (geo.cep ?? "").replace(/\D/g, "");
  const geoTemCoordenadas = geo.status === "ok"
    && Number.isFinite(geo.latitude)
    && Number.isFinite(geo.longitude);
  // Só vinculamos GPS e CEP quando o reverse-geocode confirma que ambos
  // representam o mesmo local. Isso evita validar a casa atual quando o serviço
  // será executado em outro endereço.
  const coordenadasServico = useMemo<CoordenadasServico | null>(() => (
    geoTemCoordenadas
      && cepDigitos.length === 8
      && (
        (geoCepDigitos.length === 8 && geoCepDigitos === cepDigitos)
        || cepConfirmadoGps === cepDigitos
      )
      ? { latitude: Number(geo.latitude), longitude: Number(geo.longitude) }
      : null
  ), [geoTemCoordenadas, geo.latitude, geo.longitude, geoCepDigitos, cepDigitos, cepConfirmadoGps]);
  const chaveCobertura = `${cepDigitos}:${specialty ?? "todos"}:${coordenadasServico?.latitude.toFixed(5) ?? "cep"}:${coordenadasServico?.longitude.toFixed(5) ?? "cep"}`;

  // pede a localização assim que o cliente entra no fluxo
  useEffect(() => {
    let vivo = true;
    detectarLocalizacaoDetalhada((coordenadas) => {
      if (!vivo) return;
      setGeo({ status: "coordenadas", ...coordenadas });
    }).then((r) => {
      if (!vivo) return;
      if (r.status === "ok") setGeo({
        status: "ok",
        cidade: r.cidade,
        uf: r.uf,
        cep: r.cep,
        latitude: r.latitude,
        longitude: r.longitude,
        accuracy: r.accuracy,
      });
      else setGeo({ status: r.status });
    });
    return () => { vivo = false; };
  }, []);

  // CEP vindo da home já chega resolvido, sem o cliente digitar de novo
  useEffect(() => {
    const dig = cepInicial.replace(/\D/g, "");
    if (dig.length !== 8) return;
    const requestId = ++cepRequestId.current;
    let vivo = true;
    buscarCep(dig).then((info) => {
      if (!vivo || requestId !== cepRequestId.current) return;
      if (info) {
        setBairro(info.bairro);
        setCidadeCep(info.cidade); setUfCep(info.uf); setCepStatus("ok");
      } else setCepStatus("nao");
    });
    return () => { vivo = false; };
  }, [cepInicial]);

  const btu = useMemo(
    () => calcularBtu({ areaM2, numPessoas, insolacaoAlta, andarOuTelhado, eletronicos }),
    [areaM2, numPessoas, insolacaoAlta, andarOuTelhado, eletronicos],
  );

  useEffect(() => {
    if (stepAtual !== "catalogo") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setProdutosCarregando(true);
      setBuscaErro(null);
      try {
        const params = new URLSearchParams({
          kind: "produtos",
          page: "1",
          btu: String(btu.btuRecomendado),
          q: produtoBusca,
        });
        const pagina = await carregarPagina<ProdutoDTO>(params, controller.signal);
        setProdutosLista(pagina.items);
        setProdutosTotal(pagina.total);
        setProdutosPagina(1);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setBuscaErro(error instanceof Error ? error.message : "Não foi possível carregar o catálogo.");
        }
      } finally {
        if (!controller.signal.aborted) setProdutosCarregando(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [stepAtual, btu.btuRecomendado, produtoBusca]);

  useEffect(() => {
    if (stepAtual !== "profissional") return;
    if (cepDigitos.length !== 8 || cepStatus !== "ok") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setProfissionaisCarregando(true);
      setBuscaErro(null);
      try {
        const pagina = await carregarProfissionaisPagina({
          page: 1,
          cep: cepDigitos,
          specialty,
          sort: proSort,
          q: proBusca,
          coordenadas: coordenadasServico,
        }, controller.signal);
        setProfissionaisLista(pagina.items);
        setProfissionaisTotal(pagina.total);
        setProfissionaisPagina(1);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setBuscaErro(error instanceof Error ? error.message : "Não foi possível carregar os profissionais.");
        }
      } finally {
        if (!controller.signal.aborted) setProfissionaisCarregando(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [stepAtual, cepDigitos, cepStatus, specialty, proBusca, proSort, coordenadasServico]);

  /* A ordenação pesada acontece no banco antes da paginação. A UI apenas marca
     os itens com capacidade exata, sem reordenar páginas isoladamente. */
  const produtosOrdenados = useMemo(() => {
    return produtosLista.map((p) => ({ ...p, recomendado: p.btu === btu.btuRecomendado }));
  }, [produtosLista, btu.btuRecomendado]);

  const qtdRecomendados = produtosOrdenados.filter((p) => p.recomendado).length;

  const prosOrdenados = useMemo(() => {
    return profissionaisLista
      .map((p) => {
        // sem especialidade (tipo "outros"), usa a skill mais forte do profissional
        const skill = specialty
          ? p.skills.find((s) => s.specialty === specialty)!
          : [...p.skills].sort((a, b) => b.ratingAvg - a.ratingAvg)[0];
        return { ...p, skill, patrocinado: specialty ? p.destaqueEm.includes(specialty) : false };
      })
      .filter((p) => p.skill);
  }, [profissionaisLista, specialty]);

  const produtoSel = produtoSelecionado;
  // Se a cobertura mudar enquanto o cliente está no fluxo, a seleção antiga
  // deixa de ser válida imediatamente, sem depender de um efeito posterior.
  const prosSel = chaveSelecao === chaveCobertura ? profissionaisSelecionados : [];
  const profissionaisIds = prosSel.map((p) => p.id);
  /* Estimativa de mão de obra, exibida apenas como referência. O preço real vem
     da proposta de cada profissional — instalação varia demais com metragem de
     linha, parede e acesso para ter tabela fixa. */
  const estimativaInstalacao = comCatalogo ? precoInstalacao(btu.btuRecomendado) : 0;
  const foraDaArea = cepStatus === "ok" && ufCep && ufCep !== ESTADO;

  function goTriagem(t: JobType) {
    setJobType(t); setProdutoId(null); setProdutoSelecionado(null); setProfissionaisSelecionados([]);
    setProblemas([]); setUrgencia(""); setServicoOutro(""); setJaTemEquipamento(null);
    setFotos([]); setQuantidade(1);
    setIdx(1);
  }
  function toggleProfissional(profissional: ProfissionalDTO) {
    setChaveSelecao(chaveCobertura);
    setProfissionaisSelecionados((cur) => {
      const atuais = chaveSelecao === chaveCobertura ? cur : [];
      return atuais.some((item) => item.id === profissional.id)
        ? atuais.filter((item) => item.id !== profissional.id)
        : atuais.length >= MAX_DESTINATARIOS ? atuais : [...atuais, profissional];
    });
  }

  async function carregarMaisProdutos() {
    setProdutosCarregando(true);
    setBuscaErro(null);
    try {
      const proxima = produtosPagina + 1;
      const params = new URLSearchParams({
        kind: "produtos", page: String(proxima), btu: String(btu.btuRecomendado), q: produtoBusca,
      });
      const pagina = await carregarPagina<ProdutoDTO>(params);
      setProdutosLista((atuais) => [...atuais, ...pagina.items.filter((p) => !atuais.some((a) => a.id === p.id))]);
      setProdutosPagina(proxima);
      setProdutosTotal(pagina.total);
    } catch (error) {
      setBuscaErro(error instanceof Error ? error.message : "Não foi possível carregar mais produtos.");
    } finally {
      setProdutosCarregando(false);
    }
  }

  async function carregarMaisProfissionais() {
    setProfissionaisCarregando(true);
    setBuscaErro(null);
    try {
      const proxima = profissionaisPagina + 1;
      const pagina = await carregarProfissionaisPagina({
        page: proxima,
        cep: cepDigitos,
        specialty,
        sort: proSort,
        q: proBusca,
        coordenadas: coordenadasServico,
      });
      setProfissionaisLista((atuais) => [...atuais, ...pagina.items.filter((p) => !atuais.some((a) => a.id === p.id))]);
      setProfissionaisPagina(proxima);
      setProfissionaisTotal(pagina.total);
    } catch (error) {
      setBuscaErro(error instanceof Error ? error.message : "Não foi possível carregar mais profissionais.");
    } finally {
      setProfissionaisCarregando(false);
    }
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
    const requestId = ++cepRequestId.current;
    const f = formatarCep(v);
    setCep(f);
    setCepConfirmadoGps(null);
    setProfissionaisSelecionados([]);
    const dig = f.replace(/\D/g, "");
    if (dig.length === 8) {
      setCepStatus("buscando");
      const info = await buscarCep(dig);
      if (requestId !== cepRequestId.current) return;
      if (info) {
        setBairro(info.bairro);
        setCidadeCep(info.cidade); setUfCep(info.uf); setCepStatus("ok");
      } else setCepStatus("nao");
    } else {
      setCidadeCep("");
      setUfCep("");
      setCepStatus("idle");
    }
  }

  function usarLocalizacaoAtual() {
    if (geoCepDigitos.length === 8) void aoDigitarCep(geoCepDigitos);
  }

  function confirmarCepDaLocalizacaoAtual() {
    if (geoTemCoordenadas && cepDigitos.length === 8) setCepConfirmadoGps(cepDigitos);
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

  /* Chaves que `aceitar_quote` promove de `detalhes` para colunas de `jobs`.
     Os nomes precisam bater com a função no banco — ver perguntas-orcamento.ts. */
  function detalhesCompletos(): Record<string, string> {
    const base: Record<string, string> = {};
    if (equipmentInitial) base.equipment_id = equipmentInitial.id;
    if (comCatalogo) {
      base.area_m2 = String(areaM2);
      base.ambiente = ambiente;
      base.num_pessoas = String(numPessoas);
      base.insolacao_alta = String(insolacaoAlta);
      base.andar_ou_telhado = String(andarOuTelhado);
    }
    return base;
  }

  function confirmar() {
    if (!jobType || profissionaisIds.length === 0) return;
    setErro(null);
    startTransition(async () => {
      const res = await criarPedidoOrcamento({
        jobType,
        cep,
        cidade: cidadeCep,
        bairro: bairro || undefined,
        quantidade,
        urgencia: URGENCIA_ID[urgencia],
        descricao: montarDescricao() || undefined,
        detalhes: detalhesCompletos(),
        produtoId: comCatalogo ? produtoId : null,
        btuRecomendado: comCatalogo ? btu.btuRecomendado : null,
        profissionaisIds,
        fotos: fotos.map((foto) => foto.path),
        latitude: coordenadasServico?.latitude,
        longitude: coordenadasServico?.longitude,
      });
      if (res.ok) {
        captureAnalytics("request_created", { job_type: jobType, target_count: res.enviados, reused_equipment: Boolean(equipmentInitial), experience_version: ANALYTICS_VERSION });
        setSucessoId(res.pedidoId);
        setEnviados(res.enviados);
      } else setErro(res.error);
    });
  }

  // ---------- SUCESSO ----------
  if (sucessoId) {
    return (
      <Shell geo={geo}>
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ display: "inline-grid", placeItems: "center", width: 64, height: 64, borderRadius: "50%", background: "var(--cool-wash)", color: "var(--cool-deep)" }}><CheckIcon size={32} /></div>
          <h1 style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-0.02em", margin: "16px 0 8px" }}>Pedido enviado!</h1>
          <p style={{ color: "var(--ink-soft)", maxWidth: 440, margin: "0 auto 8px" }}>
            {enviados === 1
              ? "Um profissional recebeu seu pedido"
              : `${enviados} profissionais receberam seu pedido`}{" "}
            e vão responder com propostas. Você compara preço, prazo e garantia antes de escolher —
            sem compromisso.
          </p>
          <p style={{ color: "var(--ink-faint)", fontSize: 13.5, maxWidth: 440, margin: "0 auto 24px" }}>
            Enquanto isso, dá para conversar com eles pelo chat para tirar dúvidas.
          </p>
          <Link href={`/painel/orcamentos/${sucessoId}`} style={btnPrimary}>Ver meu pedido</Link>
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

          <div style={{ position: "relative", marginBottom: 18 }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-faint)", display: "flex" }}>
              <Search size={17} />
            </span>
            <input
              value={produtoBusca}
              onChange={(e) => setProdutoBusca(e.target.value)}
              placeholder="Buscar por marca, modelo ou distribuidora"
              style={{ ...input, paddingLeft: 38 }}
            />
          </div>

          {buscaErro && <Aviso>{buscaErro}</Aviso>}
          {produtosCarregando && produtosOrdenados.length === 0 ? (
            <Aviso>Carregando aparelhos disponíveis…</Aviso>
          ) : produtosOrdenados.length === 0 ? (
            <Aviso>Nenhum aparelho disponível no catálogo com essa busca.</Aviso>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px,1fr))", gap: 14 }}>
                {produtosOrdenados.map((p) => {
                  const sel = p.id === produtoId;
                  return (
                    <button key={p.id} onClick={() => { setProdutoId(p.id); setProdutoSelecionado(p); }} style={{ ...prodCard, ...(sel ? prodCardSel : {}) }}>
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
              {produtosLista.length < produtosTotal && (
                <button type="button" className="btn" onClick={carregarMaisProdutos} disabled={produtosCarregando}
                  style={{ marginTop: 16, width: "100%" }}>
                  {produtosCarregando ? "Carregando…" : `Mostrar mais (${produtosLista.length} de ${produtosTotal})`}
                </button>
              )}
            </>
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
          <H titulo="Para quem enviar o pedido"
            sub={`Escolha até ${MAX_DESTINATARIOS}. Cada um responde com a própria proposta e você compara antes de decidir.`} />
          <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-faint)", display: "flex" }}><Search size={17} /></span>
              <input value={proBusca} onChange={(e) => setProBusca(e.target.value)} placeholder="Buscar por nome"
                style={{ ...input, paddingLeft: 38 }} />
            </div>
            <select value={proSort} onChange={(e) => setProSort(e.target.value as typeof proSort)} style={{ ...input, width: "auto" }}>
              <option value="relevancia">Relevância</option>
              <option value="nota">Melhor avaliados</option>
              <option value="servicos">Mais serviços</option>
              <option value="resposta">Maior taxa de resposta</option>
              <option value="disponibilidade">Menor agenda ativa</option>
            </select>
          </div>

          {buscaErro && <Aviso>{buscaErro}</Aviso>}
          {profissionaisCarregando && prosOrdenados.length === 0 ? (
            <Aviso>Buscando profissionais que atendem o local do serviço…</Aviso>
          ) : prosOrdenados.length === 0 ? (
            <Aviso>Nenhum profissional atende este local{specialty ? ` para “${SPECIALTY_LABEL[specialty]}”` : ""}{proBusca ? " com esse nome" : ""}.</Aviso>
          ) : (
            <div className="pro-grade">
              {prosOrdenados.map((p) => {
                const sel = profissionaisIds.includes(p.id);
                const cheio = !sel && profissionaisIds.length >= MAX_DESTINATARIOS;
                return (
                  <div key={p.id} onClick={() => toggleProfissional(p)} role="button" tabIndex={0}
                    aria-pressed={sel}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleProfissional(p); } }}
                    className="pro-card" data-sel={String(sel)}
                    style={cheio ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                    title={cheio ? `Você já escolheu ${MAX_DESTINATARIOS} profissionais` : undefined}>

                    {/* Retrato: avatar do profissional; sem foto, bloco colorido com iniciais */}
                    <div className="pro-capa">
                      {p.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.avatarUrl} alt={p.nome} />
                      ) : (
                        <span className="pro-capa-iniciais" style={{ background: corDoId(p.id) }}>
                          {iniciais(p.nome)}
                        </span>
                      )}
                      {p.patrocinado && <span className="pro-patroc">Patrocinado</span>}
                      {sel && <span className="pro-check"><CheckIcon size={15} /></span>}
                    </div>

                    <div className="pro-corpo">
                      <span style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{p.nome}</span>

                      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-faint)" }}>
                        {p.tipo === "empresa" ? <Building size={14} /> : <User size={14} />}
                        {p.tipo === "empresa" ? "Empresa" : "Autônomo"}
                        <span>·</span>
                        <MapPin size={13} /> {p.coverageMode === "raio" ? "Dentro do raio de atendimento" : `${cidadeCep || CIDADE} · cobertura por CEP`}
                      </span>

                      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
                        <span style={{ color: "var(--warm)", display: "flex" }}><Star size={14} filled /></span>
                        <strong>{p.skill.ratingAvg.toFixed(1)}</strong>
                        <span style={{ color: "var(--ink-faint)" }}>
                          ({p.skill.ratingCount}) · {p.skill.jobsCompleted} serviços
                        </span>
                      </span>

                      <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                        {Math.round(p.responseRate * 100)}% de resposta · {p.activeJobs} serviço(s) ativo(s)
                      </span>

                      {/* Especialidades como chips — o cliente compara de relance */}
                      <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
                        {p.skills.slice(0, 3).map((s) => (
                          <span key={s.specialty} className="pro-chip">{SPECIALTY_LABEL[s.specialty] ?? s.specialty}</span>
                        ))}
                      </span>

                      <Link href={`/profissional/${p.id}`} target="_blank" onClick={(e) => e.stopPropagation()}
                        className="pro-link">Acessar perfil →</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {profissionaisLista.length < profissionaisTotal && (
            <button type="button" className="btn" onClick={carregarMaisProfissionais} disabled={profissionaisCarregando}
              style={{ marginTop: 16, width: "100%" }}>
              {profissionaisCarregando ? "Carregando…" : `Mostrar mais (${profissionaisLista.length} de ${profissionaisTotal})`}
            </button>
          )}
          {profissionaisIds.length > 0 && (
            <p style={{ fontSize: 13.5, color: "var(--ink-soft)", marginTop: 16 }}>
              {profissionaisIds.length} de {MAX_DESTINATARIOS} selecionados.
            </p>
          )}
          <Nav onBack={voltar} onNext={avancar} nextLabel="Continuar" disabled={profissionaisIds.length === 0} />
        </>
      )}

      {/* ---------- REGIÃO ----------
          Só CEP e bairro: para orçar, é o que o profissional precisa. Rua e
          número só são informados quando o cliente aceita uma proposta — antes
          disso não há motivo para expor o endereço a cinco desconhecidos. */}
      {stepAtual === "endereco" && (
        <>
          <H titulo="Onde é o serviço?" sub="O endereço completo só é informado quando você aceitar uma proposta." />
          <Campo label="CEP">
            <input value={cep} onChange={(e) => aoDigitarCep(e.target.value)} inputMode="numeric" placeholder="00000-000" style={input} />
            {cepStatus === "buscando" && <span style={hint}>Buscando endereço…</span>}
            {cepStatus === "nao" && <span style={{ ...hint, color: "var(--warm)" }}>CEP não encontrado. Informe o bairro abaixo.</span>}
            {cepStatus === "ok" && <span style={{ ...hint, color: "var(--good)" }}>{cidadeCep} — {ufCep}</span>}
          </Campo>
          <Campo label="Bairro"><input value={bairro} onChange={(e) => setBairro(e.target.value)} placeholder="Bairro" style={input} /></Campo>
          {coordenadasServico && (
            <div style={{ ...avisoBox, background: "var(--cool-wash)", color: "var(--cool-deep)" }}>
              <strong>Localização confirmada.</strong> A lista será filtrada pela distância real até a base privada de cada técnico.
            </div>
          )}
          {geo.status === "ok" && geoCepDigitos.length === 8 && geoCepDigitos !== cepDigitos && (
            <div style={{ ...avisoBox, background: "var(--surface-2)", color: "var(--ink-soft)" }}>
              <div>Sua localização atual parece estar no CEP {formatarCep(geoCepDigitos)}. O CEP informado será usado sem GPS.</div>
              <button type="button" onClick={usarLocalizacaoAtual} style={{ ...btnGhost, height: 38, marginTop: 10 }}>
                Usar minha localização atual
              </button>
            </div>
          )}
          {geoTemCoordenadas && geoCepDigitos.length !== 8 && cepDigitos.length === 8 && !coordenadasServico && (
            <div style={{ ...avisoBox, background: "var(--surface-2)", color: "var(--ink-soft)" }}>
              <div>Encontramos sua posição, mas não foi possível identificar o CEP automaticamente.</div>
              <button type="button" onClick={confirmarCepDaLocalizacaoAtual} style={{ ...btnGhost, height: 38, marginTop: 10 }}>
                Este CEP é onde estou agora
              </button>
            </div>
          )}
          {foraDaArea && <Aviso>Este CEP fica em {ufCep}. No momento atendemos {CIDADE} — {ESTADO}. Você pode continuar, mas talvez não haja profissionais na região.</Aviso>}
          <Nav onBack={voltar} onNext={avancar} nextLabel="Buscar profissionais" disabled={cepDigitos.length !== 8 || cepStatus !== "ok"} />
        </>
      )}

      {/* ---------- CONFIRMAR ---------- */}
      {stepAtual === "confirmar" && (
        <>
          <H titulo="Confirme o pedido de orçamento" sub="Revise antes de enviar. Você não se compromete com nada agora." />

          {/* Só o que ainda falta e é barato de responder. Detalhe técnico do
              local fica para a hora de fechar com alguém. */}
          <Campo label="Quantos aparelhos">
            <input value={quantidade} onChange={(e) => setQuantidade(Math.max(1, Number(e.target.value) || 1))}
              type="number" min={1} max={100} style={input} />
          </Campo>

          {comCatalogo && (
            <div style={{ marginBottom: 18 }}>
              <span style={labelTxt}>Urgência</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {URGENCIAS.map((u) => (
                  <button key={u} type="button" onClick={() => setUrgencia(u)} style={{ ...chip, ...(urgencia === u ? chipOn : {}) }}>{u}</button>
                ))}
              </div>
            </div>
          )}

          <FotosPedido userId={userId} fotos={fotos} onChange={setFotos} />

          <div style={{ ...resumo, marginTop: 20 }}>
            <LinhaResumo k="Serviço" v={JOBS.find((j) => j.tipo === jobType)!.titulo} />
            {jobType === "outros" && servicoOutro && <LinhaResumo k="Descrição" v={servicoOutro} />}
            <LinhaResumo k="Enviar para" v={prosSel.map((p) => p.nome).join(", ") || "-"} />
            {quantidade > 1 && <LinhaResumo k="Quantidade" v={`${quantidade} aparelhos`} />}
            {comCatalogo && <LinhaResumo k="Ambiente" v={`${tipoImovel} · ${ambiente} · ${areaM2} m² · ${formatarBtu(btu.btuRecomendado)}`} />}
            {comCatalogo && jaTemEquipamento === true && <LinhaResumo k="Aparelho" v="Cliente já possui" />}
            {produtoSel && <LinhaResumo k="Aparelho" v={`${produtoSel.modelo}${produtoSel.distribuidora ? ` · ${produtoSel.distribuidora}` : ""}`} />}
            {!comCatalogo && problemas.length > 0 && <LinhaResumo k="Problemas" v={problemas.join(", ")} />}
            {urgencia && <LinhaResumo k="Urgência" v={urgencia} />}
            <LinhaResumo k="Região" v={`${bairro ? `${bairro} · ` : ""}${cep}`} />
            {fotos.length > 0 && <LinhaResumo k="Fotos" v={`${fotos.length} enviada${fotos.length > 1 ? "s" : ""}`} />}
            {descricao && <LinhaResumo k="Detalhes" v={descricao} />}

            <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0", paddingTop: 10 }} />
            {/* O aparelho tem preço de catálogo; a mão de obra vem da proposta de
                cada profissional. Mostrar "total" aqui seria inventar número. */}
            {produtoSel && <LinhaResumo k="Aparelho (catálogo)" v={formatarBRL(produtoSel.precoVenda)} />}
            {comCatalogo && (
              <LinhaResumo k="Instalação (estimativa)" v={`a partir de ${formatarBRL(estimativaInstalacao)}`} />
            )}
            <LinhaResumo
              k={<strong>Mão de obra</strong>}
              v={<strong>definida na proposta de cada profissional</strong>}
            />
          </div>
          {erro && <Aviso erro>{erro}</Aviso>}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={voltar} style={btnGhost} disabled={pending}>Voltar</button>
            <button onClick={confirmar} style={{ ...btnPrimary, flex: 1, opacity: pending ? 0.7 : 1 }} disabled={pending}>
              {pending
                ? "Enviando..."
                : `Pedir orçamento a ${profissionaisIds.length} profissiona${profissionaisIds.length === 1 ? "l" : "is"}`}
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

/* ---------- subcomponentes ---------- */
function Shell({ children, geo }: { children: React.ReactNode; geo: GeoState }) {
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

function GeoBanner({ geo }: { geo: GeoState }) {
  let texto: string, cor = "var(--ink-soft)", bg = "var(--surface-2)";
  if (geo.status === "pedindo") texto = "Detectando sua localização…";
  else if (geo.status === "coordenadas") texto = "Localização encontrada. Confirmando o CEP…";
  else if (geo.status === "ok") {
    const naArea = (geo.uf ?? "") === ESTADO;
    texto = naArea
      ? `Você está em ${geo.cidade || CIDADE}${geo.uf ? " — " + geo.uf : ""}. Sua posição pode validar o raio dos técnicos.`
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
  return <div style={{ ...avisoBox, background: erro ? "var(--danger-wash)" : "var(--warm-wash)", color: erro ? "var(--danger)" : "var(--warm)" }}>{children}</div>;
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
const resumo: CSSProperties = { padding: "18px 22px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line)" };
const btnPrimary: CSSProperties = { height: 46, padding: "0 22px", borderRadius: 10, background: "var(--cool)", color: "#fff", fontWeight: 600, fontSize: 15, border: "none", cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" };
const btnGhost: CSSProperties = { height: 46, padding: "0 20px", borderRadius: 10, background: "var(--surface)", color: "var(--ink-soft)", fontWeight: 600, fontSize: 15, border: "1px solid var(--line)", cursor: "pointer" };
