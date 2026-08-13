"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { Check, ArrowRight, Bolt, Shield, Star, Wrench } from "@/components/icons";
import { formatarBRL } from "@/lib/pricing";
import { registrarInteresse, type Ciclo } from "./actions";
import "./planos.css";

/* Vitrine de assinatura.
 *
 * O texto de venda mora aqui, não no banco: iterar copy não deve exigir
 * migration. O banco entrega o que é fato — nome, preço, ordem, destaque — e o
 * front entrega o argumento. As duas metades se casam por `slug`.
 */

export type PlanoDTO = {
  slug: string;
  nome: string;
  headline: string | null;
  precoMensal: number;
  precoAnual: number | null;
  destaque: boolean;
};

type Beneficio = { texto: string; incluso: boolean };

const COPY: Record<string, { promessa: string; beneficios: Beneficio[] }> = {
  essencial: {
    promessa:
      "Você entra na busca da sua região e responde quantos orçamentos quiser. Sem taxa por lead.",
    beneficios: [
      { texto: "Perfil completo e visível na busca da sua região", incluso: true },
      { texto: "Orçamentos ilimitados — nada de pagar por contato", incluso: true },
      { texto: "Reputação separada por especialidade", incluso: true },
      { texto: "Financeiro básico: o que entrou em cada serviço", incluso: true },
      { texto: "Agenda do dia com cliente e endereço", incluso: false },
      { texto: "Custo por obra e lucro real", incluso: false },
      { texto: "Assistente técnico", incluso: false },
    ],
  },
  profissional: {
    promessa:
      "Além de receber serviço, você passa a saber quanto sobrou em cada obra — e quais tipos de serviço valem a sua ida.",
    beneficios: [
      { texto: "Tudo do Essencial", incluso: true },
      { texto: "Agenda do dia: serviço, cliente, endereço e detalhes", incluso: true },
      { texto: "Custo por obra — combustível, material, ajudante", incluso: true },
      { texto: "Lucro real por serviço, não só faturamento", incluso: true },
      { texto: "Gráficos de faturamento, lucro e taxa de fechamento", incluso: true },
      { texto: "1 slot patrocinado na sua especialidade", incluso: true },
      { texto: "Até 3 técnicos na conta", incluso: true },
    ],
  },
  master: {
    promessa:
      "Para empresa com equipe em campo: agenda e resultado por técnico, e um assistente que adianta a parte técnica do orçamento.",
    beneficios: [
      { texto: "Tudo do Profissional", incluso: true },
      { texto: "Assistente técnico: dimensionamento de BTU e diagnóstico", incluso: true },
      { texto: "Rascunho de orçamento gerado a partir do pedido do cliente", incluso: true },
      { texto: "Até 10 técnicos, com agenda e financeiro por técnico", incluso: true },
      { texto: "3 slots patrocinados", incluso: true },
      { texto: "Suporte prioritário", incluso: true },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Primitivas de animação                                              */
/* ------------------------------------------------------------------ */

/** Respeita `prefers-reduced-motion`. Toda animação desta página passa por
 *  aqui: sem isso, quem pede menos movimento pega uma página que se mexe
 *  inteira — e, no pior caso, conteúdo preso invisível. */
function useReduzirMovimento() {
  const [reduzir, setReduzir] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const aplicar = () => setReduzir(mq.matches);
    aplicar();
    mq.addEventListener("change", aplicar);
    return () => mq.removeEventListener("change", aplicar);
  }, []);
  return reduzir;
}

/** A página segue o cursor: um facho suave preso ao ponteiro, amortecido por
 *  mola para não grudar no pixel e parecer nervoso. */
function FachoDoCursor({ ativo }: { ativo: boolean }) {
  const x = useMotionValue(-1000);
  const y = useMotionValue(-1000);
  const sx = useSpring(x, { stiffness: 90, damping: 26, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 90, damping: 26, mass: 0.6 });

  useEffect(() => {
    if (!ativo) return;
    const mover = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
    };
    window.addEventListener("pointermove", mover, { passive: true });
    return () => window.removeEventListener("pointermove", mover);
  }, [ativo, x, y]);

  const fundo = useMotionTemplate`radial-gradient(420px circle at ${sx}px ${sy}px, color-mix(in srgb, var(--cool) 34%, transparent), transparent 72%)`;

  if (!ativo) return null;
  return <motion.div className="pl-spot" aria-hidden style={{ background: fundo }} />;
}

/** Revelação por corte vertical: cada palavra sobe de dentro de uma máscara.
 *  É o efeito de abertura de vídeo — a linha se monta em vez de aparecer. */
function RevelaCorte({
  texto,
  atraso = 0,
  passo = 0.055,
  reduzir,
}: {
  texto: string;
  atraso?: number;
  passo?: number;
  reduzir: boolean;
}) {
  const palavras = texto.split(" ");
  if (reduzir) return <>{texto}</>;

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", columnGap: "0.28em" }}>
      {/* O texto real fica disponível de uma vez para leitor de tela; os
          pedaços animados são decorativos. */}
      <span className="pl-sr">{texto}</span>
      {palavras.map((palavra, i) => (
        <span key={i} aria-hidden style={{ display: "inline-flex", overflow: "hidden", paddingBottom: "0.08em" }}>
          <motion.span
            style={{ display: "inline-block", willChange: "transform" }}
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            transition={{ type: "spring", stiffness: 230, damping: 30, delay: atraso + i * passo }}
          >
            {palavra}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/** Entrada padrão das seções: sobe, desfoca e assenta quando entra em tela. */
function Revela({
  children,
  atraso = 0,
  reduzir,
  className,
}: {
  children: React.ReactNode;
  atraso?: number;
  reduzir: boolean;
  className?: string;
}) {
  if (reduzir) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.55, delay: atraso, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Número que corre até o valor. Usado no preço e no recibo — a troca
 *  mensal/anual precisa ser sentida, não só lida. */
function Numero({ valor, reduzir, prefixo = "" }: { valor: number; reduzir: boolean; prefixo?: string }) {
  const mv = useMotionValue(valor);
  const mola = useSpring(mv, { stiffness: 120, damping: 22, mass: 0.5 });
  const [mostrado, setMostrado] = useState(valor);

  useEffect(() => {
    mv.set(valor);
  }, [valor, mv]);

  useMotionValueEvent(mola, "change", (v) => setMostrado(v));

  const n = reduzir ? valor : mostrado;
  return (
    <>
      {prefixo}
      {Math.round(n).toLocaleString("pt-BR")}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Ato 1 — a conta que ninguém faz                                     */
/* ------------------------------------------------------------------ */

const RECIBO = [
  { rot: "Instalação 12.000 BTU", val: 600, tipo: "entrada" as const },
  { rot: "Combustível (ida e volta)", val: -48, tipo: "saida" as const },
  { rot: "Material — suporte, tubo, vácuo", val: -190, tipo: "saida" as const },
  { rot: "Ajudante (meio dia)", val: -120, tipo: "saida" as const },
];
const LUCRO = RECIBO.reduce((s, l) => s + l.val, 0);

function AtoConta({ reduzir }: { reduzir: boolean }) {
  const palco = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: palco,
    offset: ["start start", "end end"],
  });

  // Quantas linhas do recibo já apareceram, em função do scroll. O "vídeo" é
  // o próprio movimento do dedo do usuário.
  const [reveladas, setReveladas] = useState(reduzir ? RECIBO.length : 0);
  const progressoLinhas = useTransform(scrollYProgress, [0.12, 0.72], [0, RECIBO.length]);
  useMotionValueEvent(progressoLinhas, "change", (v) => {
    if (!reduzir) setReveladas(Math.max(0, Math.min(RECIBO.length, Math.floor(v))));
  });

  const [mostraTotal, setMostraTotal] = useState(reduzir);
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (!reduzir) setMostraTotal(v > 0.74);
  });

  const escala = useTransform(scrollYProgress, [0, 0.15], [0.94, 1]);

  const parcial = RECIBO.slice(0, reveladas).reduce((s, l) => s + l.val, 0);

  return (
    <section ref={palco} className="pl-palco" style={{ height: reduzir ? "auto" : "260vh" }}>
      <div className="pl-sticky">
        <div className="container" style={{ display: "grid", gap: 44, gridTemplateColumns: "1fr", justifyItems: "center" }}>
          <Revela reduzir={reduzir}>
            <h2 className="pl-batida" style={{ textAlign: "center", margin: 0 }}>
              Você sabe quanto faturou.
              <br />
              <span style={{ color: "var(--cool)" }}>Sabe quanto sobrou?</span>
            </h2>
          </Revela>

          <motion.div className="pl-recibo" style={reduzir ? undefined : { scale: escala }}>
            <div style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 6 }}>
              Uma obra real, linha a linha
            </div>

            {RECIBO.map((linha, i) => (
              <motion.div
                key={linha.rot}
                className="pl-recibo-linha"
                initial={reduzir ? false : { opacity: 0, x: -12 }}
                animate={reduzir || i < reveladas ? { opacity: 1, x: 0 } : { opacity: 0.12, x: -12 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="pl-recibo-rot">{linha.rot}</span>
                <span
                  className="pl-recibo-val"
                  style={{ color: linha.tipo === "entrada" ? "var(--good)" : "var(--ink)" }}
                >
                  {linha.val < 0 ? "− " : "+ "}
                  {formatarBRL(Math.abs(linha.val))}
                </span>
              </motion.div>
            ))}

            <div className="pl-recibo-total">
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
                {mostraTotal ? "Lucro real" : "Somando…"}
              </span>
              <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-0.03em", color: mostraTotal ? "var(--good)" : "var(--ink-faint)" }}>
                R$ <Numero valor={mostraTotal ? LUCRO : parcial} reduzir={reduzir} />
              </span>
            </div>

            <p style={{ margin: "14px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--ink-soft)" }}>
              Seiscentos reais na nota viram {formatarBRL(LUCRO)} no bolso. É essa diferença
              que decide se vale atravessar a cidade — e é ela que o FrioHub calcula sozinho.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Ato 2 — os planos                                                   */
/* ------------------------------------------------------------------ */

function Alternador({
  ciclo,
  onTrocar,
  reduzir,
}: {
  ciclo: Ciclo;
  onTrocar: (c: Ciclo) => void;
  reduzir: boolean;
}) {
  return (
    <div className="pl-switch" role="group" aria-label="Ciclo de cobrança">
      {(["mensal", "anual"] as const).map((c) => (
        <button
          key={c}
          type="button"
          data-on={ciclo === c}
          aria-pressed={ciclo === c}
          onClick={() => onTrocar(c)}
        >
          {ciclo === c &&
            (reduzir ? (
              <span className="pl-switch-pill" style={{ left: 4, right: 4 }} />
            ) : (
              <motion.span
                layoutId="pl-pill"
                className="pl-switch-pill"
                style={{ left: 4, right: 4 }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            ))}
          <span style={{ position: "relative" }}>{c === "mensal" ? "Mensal" : "Anual"}</span>
          {c === "anual" && <span className="pl-economia" style={{ position: "relative" }}>2 meses grátis</span>}
        </button>
      ))}
    </div>
  );
}

function CartaoPlano({
  plano,
  ciclo,
  reduzir,
  onAssinar,
  enviando,
}: {
  plano: PlanoDTO;
  ciclo: Ciclo;
  reduzir: boolean;
  onAssinar: (slug: string) => void;
  enviando: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const copy = COPY[plano.slug];

  // Brilho preso ao cursor dentro do cartão. Escrito em custom property para
  // o CSS pintar o gradiente sem re-renderizar o React a cada pixel.
  function mover(e: React.PointerEvent<HTMLDivElement>) {
    if (reduzir || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty("--pl-x", `${e.clientX - r.left}px`);
    ref.current.style.setProperty("--pl-y", `${e.clientY - r.top}px`);
    ref.current.style.setProperty("--pl-op", "1");
  }
  function sair() {
    ref.current?.style.setProperty("--pl-op", "0");
  }

  const anual = ciclo === "anual";
  const valor = anual ? (plano.precoAnual ?? plano.precoMensal * 10) : plano.precoMensal;
  const esteEnviando = enviando === plano.slug;

  return (
    <div
      ref={ref}
      className={`pl-card${plano.destaque ? " pl-card-destaque" : ""}`}
      onPointerMove={mover}
      onPointerLeave={sair}
    >
      <span className="pl-card-brilho" aria-hidden />
      {plano.destaque && <span className="pl-selo">Mais escolhido</span>}

      <h3 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>{plano.nome}</h3>
      {plano.headline && (
        <p style={{ margin: "5px 0 18px", fontSize: 14, color: "var(--ink-soft)" }}>{plano.headline}</p>
      )}

      <div className="pl-preco">
        <span style={{ fontSize: 20, fontWeight: 700, color: "var(--ink-soft)", alignSelf: "flex-start", marginTop: 6 }}>R$</span>
        <span className="pl-preco-num">
          <Numero valor={valor} reduzir={reduzir} />
        </span>
        <span style={{ fontSize: 15, color: "var(--ink-soft)", marginLeft: 3 }}>/{anual ? "ano" : "mês"}</span>
      </div>
      <p style={{ margin: "7px 0 20px", fontSize: 13, color: "var(--ink-faint)", minHeight: 18 }}>
        {anual
          ? `Equivale a ${formatarBRL(valor / 12)} por mês`
          : `${formatarBRL(plano.precoAnual ?? plano.precoMensal * 10)} no plano anual`}
      </p>

      <button
        type="button"
        className={`btn btn-block ${plano.destaque ? "btn-primary" : "btn-ghost"}`}
        onClick={() => onAssinar(plano.slug)}
        disabled={esteEnviando}
        style={{ marginBottom: 20 }}
      >
        {esteEnviando ? "Registrando…" : "Quero este plano"}
        {!esteEnviando && <ArrowRight size={17} />}
      </button>

      {copy && (
        <>
          <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.55, color: "var(--ink-soft)" }}>
            {copy.promessa}
          </p>
          <ul className="pl-feats">
            {copy.beneficios.map((b) => (
              <li key={b.texto} className={`pl-feat${b.incluso ? "" : " pl-feat-off"}`}>
                <span className="pl-feat-ico">
                  {b.incluso ? <Check size={12} /> : <span style={{ fontSize: 13, lineHeight: 1 }}>–</span>}
                </span>
                <span>{b.texto}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

const COMPARATIVO: { recurso: string; valores: [string, string, string] }[] = [
  { recurso: "Aparece na busca da região", valores: ["Sim", "Sim", "Sim"] },
  { recurso: "Orçamentos por mês", valores: ["Ilimitados", "Ilimitados", "Ilimitados"] },
  { recurso: "Agenda do dia com endereço do cliente", valores: ["—", "Sim", "Sim"] },
  { recurso: "Custo por obra e lucro real", valores: ["—", "Sim", "Sim"] },
  { recurso: "Gráficos de desempenho", valores: ["—", "Sim", "Sim"] },
  { recurso: "Assistente técnico", valores: ["—", "—", "Sim"] },
  { recurso: "Slots patrocinados", valores: ["—", "1", "3"] },
  { recurso: "Técnicos na conta", valores: ["1", "3", "10"] },
];

export function PlanosView({
  planos,
  logado,
  ehProfissional,
  cobrancaAtiva,
  boasVindas = false,
  hrefVitrine = null,
}: {
  planos: PlanoDTO[];
  logado: boolean;
  ehProfissional: boolean;
  cobrancaAtiva: boolean;
  boasVindas?: boolean;
  hrefVitrine?: string | null;
}) {
  const reduzir = useReduzirMovimento();
  const router = useRouter();
  const [ciclo, setCiclo] = useState<Ciclo>("mensal");
  const [enviando, setEnviando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [, startTransition] = useTransition();

  function assinar(slug: string) {
    if (!logado) {
      router.push(`/signup?next=${encodeURIComponent("/planos")}`);
      return;
    }
    setEnviando(slug);
    setAviso(null);
    startTransition(async () => {
      const r = await registrarInteresse(slug, ciclo);
      setEnviando(null);
      if (r.ok) {
        setAviso({
          tipo: "ok",
          texto:
            "Anotado. Seu interesse foi registrado e avisamos assim que a cobrança abrir na sua cidade — até lá o acesso continua liberado.",
        });
      } else {
        setAviso({ tipo: "erro", texto: r.erro });
      }
    });
  }

  return (
    <main className="pl-main">
      <FachoDoCursor ativo={!reduzir} />

      <div className="pl-conteudo">
        {/* ---------------- ato 0 ---------------- */}
        <section className="pl-hero">
          <div className="container">
            {/* Quem vem do cadastro precisa saber que deu certo antes de ver
                preço. Sem isso, a página de planos logo após salvar o perfil
                parece um pedágio surpresa. */}
            {boasVindas && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 14,
                  marginBottom: 30,
                  padding: "14px 18px",
                  borderRadius: 12,
                  border: "1px solid rgba(127,224,242,.32)",
                  background: "rgba(127,224,242,.10)",
                }}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 30,
                    height: 30,
                    borderRadius: 999,
                    background: "#7fe0f2",
                    color: "var(--brand-ink)",
                    flex: "0 0 auto",
                  }}
                >
                  <Check size={17} />
                </span>
                <span style={{ fontSize: 14.5, lineHeight: 1.5, color: "rgba(255,255,255,.9)" }}>
                  <strong style={{ color: "#fff" }}>Perfil de parceiro criado.</strong> Você já pode
                  ser encontrado. Escolha abaixo até onde quer ir —{" "}
                  {hrefVitrine && (
                    <Link href={hrefVitrine} style={{ color: "#7fe0f2", fontWeight: 600 }}>
                      ou veja antes como seu perfil ficou
                    </Link>
                  )}
                  .
                </span>
              </div>
            )}
            <span className="pl-eyebrow">Planos para técnicos, autônomos e empresas</span>
            <h1 className="pl-h1">
              <RevelaCorte texto="Receber serviço é metade." atraso={0.1} reduzir={reduzir} />
              <br />
              <span style={{ color: "#7fe0f2" }}>
                <RevelaCorte texto="Saber o que sobra é a outra." atraso={0.42} reduzir={reduzir} />
              </span>
            </h1>
            <Revela reduzir={reduzir} atraso={0.75}>
              <p className="pl-lead">
                O FrioHub não cobra do cliente que procura serviço. Cobra de quem atende — uma
                mensalidade fixa, sem taxa por lead e sem comissão escondida. Você escolhe até
                onde quer ir.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 26 }}>
                <a href="#planos" className="btn btn-onbrand btn-lg">
                  Ver os planos <ArrowRight size={18} />
                </a>
                <Link href="/parceiros" className="btn btn-lg" style={{ color: "#fff", border: "1px solid rgba(255,255,255,.28)" }}>
                  Como funciona para o profissional
                </Link>
              </div>
            </Revela>
          </div>
        </section>

        {/* ---------------- ato 1 ---------------- */}
        <AtoConta reduzir={reduzir} />

        {/* ---------------- ato 2 ---------------- */}
        <section id="planos" style={{ padding: "88px 0 24px", background: "var(--bg-subtle)" }}>
          <div className="container">
            <Revela reduzir={reduzir}>
              <div style={{ display: "grid", gap: 18, justifyItems: "center", textAlign: "center", marginBottom: 40 }}>
                <h2 style={{ fontSize: "clamp(1.9rem, 4vw, 2.7rem)", fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                  Três planos. Nenhuma pegadinha.
                </h2>
                <p style={{ maxWidth: "56ch", margin: 0, color: "var(--ink-soft)", lineHeight: 1.6 }}>
                  Cancele quando quiser. Sem fidelidade, sem multa, sem cobrar por orçamento
                  recebido.
                </p>
                <Alternador ciclo={ciclo} onTrocar={setCiclo} reduzir={reduzir} />
              </div>
            </Revela>

            <div className="pl-grade">
              {planos.map((p, i) => (
                <Revela key={p.slug} reduzir={reduzir} atraso={i * 0.09}>
                  <CartaoPlano
                    plano={p}
                    ciclo={ciclo}
                    reduzir={reduzir}
                    onAssinar={assinar}
                    enviando={enviando}
                  />
                </Revela>
              ))}
            </div>

            {aviso && (
              <div
                role="status"
                style={{
                  marginTop: 24,
                  padding: "14px 18px",
                  borderRadius: 12,
                  fontSize: 14.5,
                  lineHeight: 1.55,
                  border: "1px solid var(--line)",
                  background: aviso.tipo === "ok" ? "var(--cool-wash)" : "var(--warm-wash)",
                  color: "var(--ink)",
                }}
              >
                {aviso.texto}
              </div>
            )}

            {logado && !ehProfissional && (
              <p style={{ marginTop: 20, fontSize: 14, color: "var(--ink-soft)", textAlign: "center" }}>
                Sua conta é de cliente. Os planos são para quem <em>presta</em> serviço —{" "}
                <Link href="/parceiros" style={{ color: "var(--cool)", fontWeight: 600 }}>
                  veja como virar parceiro
                </Link>
                .
              </p>
            )}
          </div>
        </section>

        {/* ---------------- comparativo ---------------- */}
        <section style={{ padding: "56px 0 88px", background: "var(--bg-subtle)" }}>
          <div className="container">
            <Revela reduzir={reduzir}>
              <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 18px" }}>
                Lado a lado
              </h2>
              <div className="pl-tabela-wrap">
                <table className="pl-tabela">
                  <thead>
                    <tr>
                      <th>Recurso</th>
                      {planos.map((p) => (
                        <th key={p.slug}>{p.nome}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARATIVO.map((linha) => (
                      <tr key={linha.recurso}>
                        <td style={{ color: "var(--ink-soft)" }}>{linha.recurso}</td>
                        {linha.valores.map((v, i) => (
                          <td key={i} style={{ fontWeight: v === "—" ? 400 : 600, color: v === "—" ? "var(--ink-faint)" : "var(--ink)" }}>
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Revela>
          </div>
        </section>

        {/* ---------------- honestidade ---------------- */}
        <section style={{ padding: "0 0 88px", background: "var(--bg-subtle)" }}>
          <div className="container" style={{ display: "grid", gap: 20, maxWidth: 880 }}>
            <Revela reduzir={reduzir}>
              <div className="pl-nota">
                <strong style={{ color: "var(--ink)", display: "block", marginBottom: 6 }}>
                  Plano não compra posição na busca.
                </strong>
                A ordem dos resultados é definida por nota, serviços concluídos e tempo de
                resposta — trabalho, não mensalidade. O que os planos pagos incluem são{" "}
                <em>slots patrocinados</em>, que aparecem sempre marcados como
                &ldquo;Patrocinado&rdquo; e só são liberados para quem já tem nota e histórico
                mínimos na especialidade. Quem paga mais aparece mais; quem trabalha melhor
                ranqueia melhor. São coisas diferentes, e continuam diferentes.
              </div>
            </Revela>

            {!cobrancaAtiva && (
              <Revela reduzir={reduzir}>
                <div className="pl-nota" style={{ borderLeftColor: "var(--good)", background: "var(--cool-wash)" }}>
                  <strong style={{ color: "var(--ink)", display: "block", marginBottom: 6 }}>
                    A cobrança ainda não está ligada na sua cidade.
                  </strong>
                  Estamos no início por aqui, e cobrar mensalidade antes de ter fluxo de
                  serviço seria vender o que ainda não entregamos. Enquanto isso, o acesso
                  continua liberado. Escolher um plano agora só registra o seu interesse — nada
                  é cobrado, e avisamos antes de qualquer cobrança começar.
                </div>
              </Revela>
            )}
          </div>
        </section>

        {/* ---------------- fechamento ---------------- */}
        <section style={{ background: "var(--brand-ink)", color: "#fff", padding: "84px 0" }}>
          <div className="container" style={{ display: "grid", gap: 26, justifyItems: "center", textAlign: "center" }}>
            <Revela reduzir={reduzir}>
              <h2 style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 800, letterSpacing: "-0.03em", margin: 0, maxWidth: "18ch" }}>
                A próxima obra pode ser a primeira que você sabe se valeu.
              </h2>
            </Revela>
            <Revela reduzir={reduzir} atraso={0.1}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
                <a href="#planos" className="btn btn-onbrand btn-lg">
                  Escolher um plano <ArrowRight size={18} />
                </a>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 26, justifyContent: "center", marginTop: 30, color: "rgba(255,255,255,.72)", fontSize: 14 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Shield size={16} /> Sem fidelidade
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Bolt size={16} /> Sem taxa por lead
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Wrench size={16} /> Cancela quando quiser
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Star size={16} /> Reputação por especialidade
                </span>
              </div>
            </Revela>
          </div>
        </section>
      </div>
    </main>
  );
}
