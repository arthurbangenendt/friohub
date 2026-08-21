"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { calcularBtu, formatarBtu } from "@/lib/btu";
import { precoInstalacao } from "@/lib/pricing";
import { buscarCep, detectarLocalizacaoDetalhada, formatarCep } from "@/lib/cep";
import { ESTADO } from "@/lib/regiao";
import { criarPedidoOrcamento } from "@/app/painel/orcamentos/actions";
import { MAX_AMBIENTES, MAX_DESTINATARIOS } from "@/app/painel/orcamentos/config";
import type { FotoPendente } from "./FotosPedido";
import { aceitaCatalogo, type JobType } from "./tipos";
import type { ProdutoDTO, ProfissionalDTO } from "./marketplace-types";
import { ANALYTICS_VERSION, captureAnalytics } from "@/lib/analytics";

import type { AmbienteForm, CoordenadasServico, GeoState, StepId } from "./wizard/types";
import { SPECIALTY_OF, URGENCIA_ID, montarSteps } from "./wizard/constants";
import { novoAmbiente, proximoNomeSugerido } from "./wizard/ambiente-utils";
import { carregarPagina, carregarProfissionaisPagina } from "./wizard/api";
import { Shell, Progress } from "./wizard/shared-components";
import { barraCarrinho, barraCarrinhoInner } from "./wizard/styles";
import { formatarBRL } from "@/lib/pricing";
import { SuccessScreen } from "./wizard/SuccessScreen";

import { StepServico } from "./wizard/steps/StepServico";
import { StepAmbiente } from "./wizard/steps/StepAmbiente";
import { StepEquipamento } from "./wizard/steps/StepEquipamento";
import { StepAparelhoConhecido } from "./wizard/steps/StepAparelhoConhecido";
import { StepCatalogo } from "./wizard/steps/StepCatalogo";
import { StepCarrinho } from "./wizard/steps/StepCarrinho";
import { StepDetalhes } from "./wizard/steps/StepDetalhes";
import { StepProfissional } from "./wizard/steps/StepProfissional";
import { StepEndereco } from "./wizard/steps/StepEndereco";
import { StepConfirmar } from "./wizard/steps/StepConfirmar";

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

  // calculadora — tipo de imóvel e uso são do IMÓVEL, não de cada cômodo
  const [tipoImovel, setTipoImovel] = useState("Apartamento");
  const [periodo, setPeriodo] = useState("Durante o dia");

  /* Um ambiente por cômodo a climatizar. Quem quer ar na casa inteira quer um
     pedido, não três: descreve uma vez, recebe UMA proposta pelo pacote e o
     técnico faz tudo numa visita — que é onde nasce o desconto que a
     concorrência não consegue dar. */
  const [ambientes, setAmbientes] = useState<AmbienteForm[]>(() => [novoAmbiente("Sala")]);
  // Qual ambiente está sendo editado no catálogo (uma aba por cômodo).
  const [ambienteFoco, setAmbienteFoco] = useState(0);

  // já tem equipamento?
  const [jaTemEquipamento, setJaTemEquipamento] = useState<boolean | null>(() => equipmentInitial ? true : null);
  /* Já sabe qual MODELO quer comprar? Pergunta separada de "já tem o
     aparelho": aqui o cliente ainda vai comprar, a dúvida é se ele sabe o
     produto exato ou só o tipo. true = catálogo com preço, produto travado.
     false = catálogo sem preço, o profissional decide produto e preço. */
  const [sabeAparelho, setSabeAparelho] = useState<boolean | null>(null);

  // serviço (não-catálogo)
  const [problemas, setProblemas] = useState<string[]>([]);
  const [urgencia, setUrgencia] = useState<string>("");
  const [servicoOutro, setServicoOutro] = useState("");

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

  /* Uma carga térmica por ambiente. Calcular tudo de uma vez mantém a lista e o
     catálogo lendo do mesmo número — nada de recalcular BTU em dois lugares e
     eles divergirem. */
  const btus = useMemo(
    () => ambientes.map((a) => calcularBtu({
      areaM2: a.areaM2,
      numPessoas: a.numPessoas,
      insolacaoAlta: a.insolacaoAlta,
      andarOuTelhado: a.andarOuTelhado,
      eletronicos: a.eletronicos,
    })),
    [ambientes],
  );
  /* O foco é clampado na leitura em vez de num efeito: remover o último
     ambiente enquanto ele está selecionado não pode deixar o índice apontando
     para fora da lista nem por um render. */
  const focoSeguro = Math.min(ambienteFoco, Math.max(0, ambientes.length - 1));
  const ambienteAtivo = ambientes[focoSeguro];
  // Carga do ambiente em edição — é ela que filtra o catálogo.
  const btu = btus[focoSeguro] ?? btus[0];

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
          /* Sem preço: o cliente ainda não sabe o modelo, só navega por tipo.
             A RPC por trás nem tem a coluna de preço no retorno. */
          ...(sabeAparelho === false ? { modo: "sem_preco" } : {}),
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
  }, [stepAtual, btu.btuRecomendado, produtoBusca, sabeAparelho]);

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

  // Se a cobertura mudar enquanto o cliente está no fluxo, a seleção antiga
  // deixa de ser válida imediatamente, sem depender de um efeito posterior.
  const prosSel = chaveSelecao === chaveCobertura ? profissionaisSelecionados : [];
  const profissionaisIds = prosSel.map((p) => p.id);
  /* Estimativa de mão de obra, exibida apenas como referência. O preço real vem
     da proposta de cada profissional — instalação varia demais com metragem de
     linha, parede e acesso para ter tabela fixa. Com vários ambientes, soma-se a
     estimativa de cada um: é o piso do pacote, não de um cômodo. */
  const estimativaInstalacao = comCatalogo
    ? ambientes.reduce((total, a, i) => total + precoInstalacao(btus[i].btuRecomendado) * a.quantidade, 0)
    : 0;
  const totalAparelhos = ambientes.reduce((total, a) => total + a.quantidade, 0);
  /* Soma do catálogo: só os ambientes em que o cliente já escolheu o aparelho
     COM preço. No modo sem preço (sabeAparelho === false) `precoVenda` vem
     nulo do catálogo — não tem valor nenhum para somar, o profissional é
     quem vai definir isso na proposta. */
  const totalProdutosEscolhidos = sabeAparelho === false ? 0 : ambientes.reduce(
    (total, a) => total + (a.produto?.precoVenda ? a.produto.precoVenda * a.quantidade : 0),
    0,
  );
  const foraDaArea = cepStatus === "ok" && !!ufCep && ufCep !== ESTADO;

  function alterarAmbiente(indice: number, mudanca: Partial<AmbienteForm>) {
    setAmbientes((atuais) => atuais.map((a, i) => i === indice ? { ...a, ...mudanca } : a));
  }
  function adicionarAmbiente() {
    setAmbientes((atuais) => {
      if (atuais.length >= MAX_AMBIENTES) return atuais;
      const lista = [...atuais, novoAmbiente(proximoNomeSugerido(atuais))];
      setAmbienteFoco(lista.length - 1);
      return lista;
    });
  }
  /* Escolher o aparelho já leva para o próximo cômodo pendente. Sem isso, o
     cliente com três ambientes escolhe o primeiro e fica olhando para uma tela
     que parece não ter reagido. */
  function escolherProduto(produto: ProdutoDTO) {
    const destino = focoSeguro;
    setAmbientes((atuais) => {
      const lista = atuais.map((a, i) => (
        i === destino ? { ...a, produtoId: produto.id, produto } : a
      ));
      const pendente = lista.findIndex((a, i) => i !== destino && !a.produtoId);
      if (pendente >= 0) setAmbienteFoco(pendente);
      return lista;
    });
  }

  function removerAmbiente(indice: number) {
    setAmbientes((atuais) => {
      // Um pedido sempre tem pelo menos um ambiente — é o que o banco espera.
      if (atuais.length <= 1) return atuais;
      const lista = atuais.filter((_, i) => i !== indice);
      setAmbienteFoco((foco) => Math.min(foco, lista.length - 1));
      return lista;
    });
  }

  /* Uma única fonte de verdade para "esta etapa está respondida?". É usada pelo
     botão Continuar de cada passo E pela navegação direta da barra de progresso —
     manter as duas em regras separadas é o caminho garantido para o cliente pular
     para "Enviar" sem profissional escolhido. */
  const stepValido = useMemo(() => {
    const mapa: Record<StepId, boolean> = {
      servico: jobType !== null,
      ambiente: true,
      detalhes: jobType !== "outros" || servicoOutro.trim().length >= 10,
      equipamento: jaTemEquipamento !== null,
      aparelho_conhecido: sabeAparelho !== null,
      // Nenhum ambiente pode ficar sem aparelho: o pedido incompleto viraria
      // proposta incompleta e a diferença apareceria só na hora de pagar. No
      // modo sem preço, "escolher" também é clicar num card — só que ele vira
      // categoria, não produto travado (ver `confirmar()`).
      catalogo: ambientes.every((a) => Boolean(a.produtoId)),
      carrinho: ambientes.every((a) => Boolean(a.produtoId)),
      endereco: cepDigitos.length === 8 && cepStatus === "ok",
      profissional: profissionaisIds.length > 0,
      confirmar: true,
    };
    return mapa;
  }, [jobType, servicoOutro, jaTemEquipamento, sabeAparelho, ambientes, cepDigitos, cepStatus, profissionaisIds.length]);

  // Voltar é sempre livre. Avançar pela barra só até onde tudo antes está pronto.
  function podeIrPara(destino: number) {
    if (destino <= idx) return true;
    return steps.slice(0, destino).every((s) => stepValido[s]);
  }

  function irPara(destino: number) {
    if (!podeIrPara(destino)) return;
    setIdx(Math.max(0, Math.min(destino, steps.length - 1)));
  }

  /* Responder essa pergunta troca o modo do catálogo (com/sem preço) — a
     lista carregada até aqui é do modo ERRADO e não pode aparecer nem por um
     instante na tela seguinte. Limpar aqui, no mesmo clique, garante que o
     step de catálogo já nasce mostrando "carregando" em vez de piscar o
     preço antigo enquanto a busca nova (com debounce) ainda não voltou. */
  function escolherSabeAparelho(valor: boolean) {
    setSabeAparelho(valor);
    setProdutosLista([]);
    setProdutosTotal(0);
    setProdutosCarregando(true);
  }

  function goTriagem(t: JobType) {
    /* Voltar à etapa 1 só para conferir não pode custar as respostas: se o cliente
       reconfirma o mesmo serviço, seguimos em frente sem limpar nada. A limpeza só
       faz sentido quando ele realmente troca de serviço — aí as respostas
       anteriores são de outro questionário. */
    if (t === jobType) { setIdx(1); return; }
    setJobType(t); setProfissionaisSelecionados([]);
    setProblemas([]); setUrgencia(""); setServicoOutro(""); setJaTemEquipamento(null);
    setSabeAparelho(null);
    setFotos([]);
    setAmbientes([novoAmbiente("Sala")]);
    setAmbienteFoco(0);
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
        ...(sabeAparelho === false ? { modo: "sem_preco" } : {}),
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
      /* Com mais de um cômodo, o resumo entra na descrição: é o que o
         profissional lê primeiro para decidir se responde. */
      ambientes.length > 1
        ? `Ambientes (${ambientes.length}): ${ambientes.map((a, i) => (
            comCatalogo ? `${a.nome} — ${formatarBtu(btus[i].btuRecomendado)}` : a.nome
          )).join("; ")}`
        : "",
      jaTemEquipamento === true ? "Cliente já tem o equipamento" : "",
      problemas.length ? `Problemas: ${problemas.join(", ")}` : "",
      urgencia ? `Urgência: ${urgencia}` : "",
      descricao.trim(),
    ].filter(Boolean).join(" · ");
  }

  /* Chaves que `aceitar_quote` promove de `detalhes` para colunas de `jobs`.
     Os nomes precisam bater com a função no banco — ver perguntas-orcamento.ts.
     Com múltiplos ambientes estas chaves descrevem o PRIMEIRO; a lista completa
     viaja em `itens`, e a RPC refaz esse espelho de qualquer forma. */
  function detalhesCompletos(): Record<string, string> {
    const base: Record<string, string> = {};
    if (equipmentInitial) base.equipment_id = equipmentInitial.id;
    const primeiro = ambientes[0];
    base.ambiente = primeiro.nome;
    if (comCatalogo) {
      base.area_m2 = String(primeiro.areaM2);
      base.num_pessoas = String(primeiro.numPessoas);
      base.eletronicos = String(primeiro.eletronicos);
      base.insolacao_alta = String(primeiro.insolacaoAlta);
      base.andar_ou_telhado = String(primeiro.andarOuTelhado);
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
        /* Um pedido, N ambientes. É isto que evita o cliente refazer a triagem
           inteira para cada cômodo — e o que permite a proposta de pacote. */
        itens: ambientes.map((a, i) => ({
          ambiente: a.nome,
          areaM2: comCatalogo ? a.areaM2 : null,
          numPessoas: comCatalogo ? a.numPessoas : null,
          eletronicos: comCatalogo ? a.eletronicos : null,
          insolacaoAlta: comCatalogo ? a.insolacaoAlta : false,
          andarOuTelhado: comCatalogo ? a.andarOuTelhado : false,
          btuRecomendado: comCatalogo ? btus[i].btuRecomendado : null,
          /* Sem preço, o card clicado vira só uma REFERÊNCIA visual — o que
             viaja pro banco é a categoria, nunca um produto travado. É o
             profissional quem escolhe o modelo exato na proposta. */
          produtoId: comCatalogo && sabeAparelho !== false ? a.produtoId : null,
          categoriaDesejada: comCatalogo && sabeAparelho === false ? a.produto?.categoria ?? null : null,
          quantidade: a.quantidade,
        })),
        urgencia: URGENCIA_ID[urgencia],
        descricao: montarDescricao() || undefined,
        detalhes: detalhesCompletos(),
        profissionaisIds,
        // Sem catálogo (manutenção etc.) ou cliente que já tem o aparelho:
        // a pergunta nunca apareceu — mantém o comportamento de sempre.
        sabeAparelho: comCatalogo ? sabeAparelho ?? true : true,
        fotos: fotos.map((foto) => foto.path),
        latitude: coordenadasServico?.latitude,
        longitude: coordenadasServico?.longitude,
      });
      if (res.ok) {
        captureAnalytics("request_created", { job_type: jobType, target_count: res.enviados, reused_equipment: Boolean(equipmentInitial), ambientes: ambientes.length, experience_version: ANALYTICS_VERSION });
        setSucessoId(res.pedidoId);
        setEnviados(res.enviados);
      } else setErro(res.error);
    });
  }

  // ---------- SUCESSO ----------
  if (sucessoId) {
    return <SuccessScreen geo={geo} sucessoId={sucessoId} enviados={enviados} />;
  }

  const idxCarrinho = steps.indexOf("carrinho");
  const mostrarBarraCarrinho =
    idxCarrinho >= 0 &&
    steps[idx] !== "carrinho" &&
    !["profissional", "endereco", "confirmar"].includes(stepAtual) &&
    ambientes.some((a) => a.produto);

  return (
    <Shell geo={geo}>
      <Progress steps={steps} current={idx} onIr={irPara} podeIr={podeIrPara} />

      {/* Barra de carrinho: fixa no rodapé, some assim que o cliente já
          revisou (steps de endereço/profissional/confirmar em diante) — ali o
          resumo completo já aparece no step de confirmação. */}
      {mostrarBarraCarrinho && (
        <div style={barraCarrinho}>
          <button type="button" onClick={() => setIdx(idxCarrinho)} style={barraCarrinhoInner}>
            <span style={{ fontSize: 14 }}>
              {ambientes.filter((a) => a.produto).length} aparelho{ambientes.filter((a) => a.produto).length > 1 ? "s" : ""} selecionado{ambientes.filter((a) => a.produto).length > 1 ? "s" : ""}
            </span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>
              {sabeAparelho === false ? "Ver carrinho" : `${formatarBRL(totalProdutosEscolhidos)} · ver carrinho`}
            </span>
          </button>
        </div>
      )}

      {stepAtual === "servico" && <StepServico onEscolher={goTriagem} />}

      {stepAtual === "ambiente" && (
        <StepAmbiente
          tipoImovel={tipoImovel} onTipoImovelChange={setTipoImovel}
          periodo={periodo} onPeriodoChange={setPeriodo}
          ambientes={ambientes} btus={btus}
          onAlterarAmbiente={alterarAmbiente} onRemoverAmbiente={removerAmbiente}
          onAdicionarAmbiente={adicionarAmbiente}
          onBack={voltar} onNext={avancar}
        />
      )}

      {stepAtual === "equipamento" && (
        <StepEquipamento
          jaTemEquipamento={jaTemEquipamento} onEscolher={setJaTemEquipamento}
          descricao={descricao} onDescricaoChange={setDescricao}
          btu={btu} disabled={!stepValido.equipamento}
          onBack={voltar} onNext={avancar}
        />
      )}

      {stepAtual === "aparelho_conhecido" && (
        <StepAparelhoConhecido
          sabeAparelho={sabeAparelho} onEscolher={escolherSabeAparelho}
          disabled={!stepValido.aparelho_conhecido}
          onBack={voltar} onNext={avancar}
        />
      )}

      {stepAtual === "catalogo" && (
        <StepCatalogo
          ambientes={ambientes} ambienteAtivo={ambienteAtivo} focoSeguro={focoSeguro}
          onFocoChange={setAmbienteFoco} btus={btus} sabeAparelho={sabeAparelho}
          qtdRecomendados={qtdRecomendados} btu={btu}
          produtoBusca={produtoBusca} onBuscaChange={setProdutoBusca} buscaErro={buscaErro}
          produtosCarregando={produtosCarregando} produtosOrdenados={produtosOrdenados}
          onEscolherProduto={escolherProduto} produtosLista={produtosLista} produtosTotal={produtosTotal}
          onCarregarMais={carregarMaisProdutos} disabled={!stepValido.catalogo}
          onBack={voltar} onNext={avancar}
        />
      )}

      {stepAtual === "carrinho" && (
        <StepCarrinho
          sabeAparelho={sabeAparelho} ambientes={ambientes} btus={btus}
          onFocoChange={setAmbienteFoco} onRemoverAmbiente={removerAmbiente}
          totalProdutosEscolhidos={totalProdutosEscolhidos}
          disabled={!stepValido.carrinho} onBack={voltar} onNext={avancar}
        />
      )}

      {stepAtual === "detalhes" && (
        <StepDetalhes
          jobType={jobType} servicoOutro={servicoOutro} onServicoOutroChange={setServicoOutro}
          ambientes={ambientes} onAlterarAmbiente={alterarAmbiente} onRemoverAmbiente={removerAmbiente}
          onAdicionarAmbiente={adicionarAmbiente}
          problemas={problemas} onToggleProblema={toggleProblema}
          urgencia={urgencia} onUrgenciaChange={setUrgencia}
          descricao={descricao} onDescricaoChange={setDescricao}
          disabled={!stepValido.detalhes} onBack={voltar} onNext={avancar}
        />
      )}

      {stepAtual === "profissional" && (
        <StepProfissional
          proBusca={proBusca} onBuscaChange={setProBusca}
          proSort={proSort} onSortChange={setProSort}
          buscaErro={buscaErro} profissionaisCarregando={profissionaisCarregando}
          prosOrdenados={prosOrdenados} profissionaisIds={profissionaisIds}
          onToggleProfissional={toggleProfissional}
          cidadeCep={cidadeCep} specialty={specialty}
          profissionaisLista={profissionaisLista} profissionaisTotal={profissionaisTotal}
          onCarregarMais={carregarMaisProfissionais}
          disabled={!stepValido.profissional} onBack={voltar} onNext={avancar}
        />
      )}

      {stepAtual === "endereco" && (
        <StepEndereco
          cep={cep} onDigitarCep={aoDigitarCep} cepStatus={cepStatus}
          cidadeCep={cidadeCep} ufCep={ufCep} bairro={bairro} onBairroChange={setBairro}
          coordenadasServico={coordenadasServico} geo={geo}
          geoCepDigitos={geoCepDigitos} cepDigitos={cepDigitos}
          onUsarLocalizacaoAtual={usarLocalizacaoAtual}
          geoTemCoordenadas={Boolean(geoTemCoordenadas)}
          onConfirmarCepDaLocalizacaoAtual={confirmarCepDaLocalizacaoAtual}
          foraDaArea={foraDaArea}
          disabled={!stepValido.endereco} onBack={voltar} onNext={avancar}
        />
      )}

      {stepAtual === "confirmar" && (
        <StepConfirmar
          comCatalogo={comCatalogo} urgencia={urgencia} onUrgenciaChange={setUrgencia}
          userId={userId} fotos={fotos} onFotosChange={setFotos}
          jobType={jobType} servicoOutro={servicoOutro}
          nomesProfissionaisSelecionados={prosSel.map((p) => p.nome).join(", ")}
          tipoImovel={tipoImovel} periodo={periodo}
          totalAparelhos={totalAparelhos} ambientes={ambientes} btus={btus}
          jaTemEquipamento={jaTemEquipamento} sabeAparelho={sabeAparelho} problemas={problemas}
          bairro={bairro} cep={cep} descricao={descricao}
          totalProdutosEscolhidos={totalProdutosEscolhidos}
          temStepCarrinho={idxCarrinho >= 0} onIrParaCarrinho={() => setIdx(idxCarrinho)}
          estimativaInstalacao={estimativaInstalacao} erro={erro}
          onBack={voltar} onConfirmar={confirmar} pending={pending}
          quantidadeProfissionais={profissionaisIds.length}
        />
      )}
    </Shell>
  );
}
