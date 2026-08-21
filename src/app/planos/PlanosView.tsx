"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ArrowRight, Bolt, Shield, Star, Wrench } from "@/components/icons";
import { registrarInteresse, iniciarAssinatura, trocarPlano, type Ciclo } from "./actions";
import "./planos.css";

import { useReduzirMovimento, FachoDoCursor, RevelaCorte, Revela } from "./vitrine/animation";
import { AtoConta } from "./vitrine/AtoConta";
import { Alternador, CartaoPlano } from "./vitrine/PlanoCards";
import { ModalCheckout, ModalTrocaPlano } from "./vitrine/CheckoutModals";
import type { PlanoDTO } from "./vitrine/types";

export type { PlanoDTO };

/* Vitrine de assinatura.
 *
 * O texto de venda mora aqui, não no banco: iterar copy não deve exigir
 * migration. O banco entrega o que é fato — nome, preço, ordem, destaque — e o
 * front entrega o argumento. As duas metades se casam por `slug`.
 */

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
  precisaDocumento,
  planoAtualSlug = null,
  cobrancaAtiva,
  boasVindas = false,
  hrefVitrine = null,
}: {
  planos: PlanoDTO[];
  logado: boolean;
  ehProfissional: boolean;
  precisaDocumento: boolean;
  planoAtualSlug?: string | null;
  cobrancaAtiva: boolean;
  boasVindas?: boolean;
  hrefVitrine?: string | null;
}) {
  const reduzir = useReduzirMovimento();
  const router = useRouter();
  const [ciclo, setCiclo] = useState<Ciclo>("mensal");
  const [enviando, setEnviando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [planoCheckout, setPlanoCheckout] = useState<PlanoDTO | null>(null);
  const [erroCheckout, setErroCheckout] = useState<string | null>(null);
  const [planoTroca, setPlanoTroca] = useState<PlanoDTO | null>(null);
  const [erroTroca, setErroTroca] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const planoAtual = planoAtualSlug ? (planos.find((p) => p.slug === planoAtualSlug) ?? null) : null;

  function assinar(slug: string) {
    if (!logado) {
      router.push(`/signup?next=${encodeURIComponent("/planos")}`);
      return;
    }

    if (planoAtualSlug === slug) {
      setAviso({ tipo: "ok", texto: "Você já está neste plano." });
      return;
    }

    // Já assina outro plano: é troca (upgrade/downgrade), não uma primeira
    // assinatura — muda o modal e a Edge Function acionada.
    if (cobrancaAtiva && ehProfissional && planoAtualSlug) {
      setErroTroca(null);
      setPlanoTroca(planos.find((p) => p.slug === slug) ?? null);
      return;
    }

    // Cobrança de verdade só existe para profissional com a cidade ligada.
    // Nos outros casos (cliente avaliando, ou cidade sem cobrança) o clique
    // continua só registrando interesse — o RPC devolve a mensagem certa
    // para quem não é profissional.
    if (cobrancaAtiva && ehProfissional) {
      setErroCheckout(null);
      setPlanoCheckout(planos.find((p) => p.slug === slug) ?? null);
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

  function confirmarTroca() {
    if (!planoTroca) return;
    const slug = planoTroca.slug;
    setEnviando(slug);
    setErroTroca(null);
    startTransition(async () => {
      const r = await trocarPlano(slug);
      if (r.ok && r.tipo === "upgrade") {
        window.location.href = r.checkoutUrl;
        return;
      }
      setEnviando(null);
      setPlanoTroca(null);
      if (r.ok) {
        setAviso({ tipo: "ok", texto: r.aviso });
      } else {
        setAviso({ tipo: "erro", texto: r.erro });
      }
    });
  }

  function confirmarCheckout(documento: string) {
    if (!planoCheckout) return;
    const slug = planoCheckout.slug;
    setEnviando(slug);
    setErroCheckout(null);
    startTransition(async () => {
      const r = await iniciarAssinatura(slug, ciclo, documento);
      if (r.ok) {
        window.location.href = r.checkoutUrl;
        return;
      }
      setEnviando(null);
      setErroCheckout(r.erro);
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

      {planoCheckout && (
        <ModalCheckout
          plano={planoCheckout}
          ciclo={ciclo}
          valor={ciclo === "anual" ? (planoCheckout.precoAnual ?? planoCheckout.precoMensal * 10) : planoCheckout.precoMensal}
          precisaDocumento={precisaDocumento}
          enviando={enviando === planoCheckout.slug}
          erro={erroCheckout}
          onFechar={() => {
            setPlanoCheckout(null);
            setErroCheckout(null);
          }}
          onConfirmar={confirmarCheckout}
        />
      )}

      {planoTroca && (
        <ModalTrocaPlano
          plano={planoTroca}
          ehUpgrade={!planoAtual || planoTroca.precoMensal > planoAtual.precoMensal}
          enviando={enviando === planoTroca.slug}
          erro={erroTroca}
          onFechar={() => {
            setPlanoTroca(null);
            setErroTroca(null);
          }}
          onConfirmar={confirmarTroca}
        />
      )}
    </main>
  );
}
