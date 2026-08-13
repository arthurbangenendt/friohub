import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/site";
import { REGIAO_LABEL } from "@/lib/regiao";
import { ArrowRight, Bolt, Check, Shield, Wind } from "@/components/icons";

export const metadata = {
  title: "Venda pela FrioHub — para distribuidoras de climatização",
  description:
    "Cadastre seu catálogo e receba pedidos com instalação já contratada. Você despacha, a FrioHub cuida da venda e do cliente.",
};

/* Landing de captação do terceiro lado. Espelha /parceiros de propósito: sem uma
   porta de entrada própria, não há como recrutar distribuidora — e sem catálogo
   não existe a receita de equipamento. */
export default function DistribuidorasPage() {
  return (
    <>
      <SiteHeader />

      <section style={{ background: "var(--brand-ink)", color: "#eaf3f5" }}>
        <div className="container" style={{ padding: "84px 24px 72px", maxWidth: 820 }}>
          <p className="eyebrow" style={{ color: "#7fd0e0", marginBottom: 16 }}>Para distribuidoras</p>
          <h1 style={{ fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 800, lineHeight: 1.06, marginBottom: 18 }}>
            Seu estoque vendendo com a instalação já contratada.
          </h1>
          <p style={{ fontSize: "1.15rem", color: "#b8d3da", lineHeight: 1.55, maxWidth: 620 }}>
            Na FrioHub o cliente escolhe o aparelho e o instalador no mesmo lugar. Você recebe o pedido
            pronto, com endereço e prazo — sem vitrine para montar, sem anúncio para pagar, sem
            atendimento para fazer.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 30 }}>
            <Link href="/signup?role=distribuidora" className="btn btn-onbrand btn-lg" style={{ gap: 8 }}>
              Cadastrar distribuidora <ArrowRight size={18} />
            </Link>
            <Link href="#como-funciona" className="btn btn-lg"
              style={{ background: "rgba(255,255,255,.1)", color: "#eaf6fa", border: "1px solid rgba(255,255,255,.2)" }}>
              Como funciona
            </Link>
          </div>
        </div>
      </section>

      <section id="como-funciona" style={{ padding: "80px 0" }}>
        <div className="container">
          <p className="eyebrow" style={{ marginBottom: 12 }}>Como funciona</p>
          <h2 style={{ fontSize: "clamp(1.7rem, 3.6vw, 2.3rem)", fontWeight: 800, lineHeight: 1.1, maxWidth: 620 }}>
            Do cadastro ao despacho, em quatro passos
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 24, marginTop: 44 }}>
            <Passo n="01" titulo="Cadastre o catálogo"
              desc="Marca, modelo, capacidade e o seu custo. O preço ao cliente é definido pela FrioHub." />
            <Passo n="02" titulo="Controle o estoque"
              desc="Produto sem estoque sai da busca na hora. Nada de venda que você não consegue entregar." />
            <Passo n="03" titulo="Receba o pedido"
              desc="Quando o cliente fecha, o pedido chega no seu painel com endereço e prazo." />
            <Passo n="04" titulo="Despache e informe"
              desc="Confirme, fature, envie o rastreio. O cliente acompanha tudo pelo painel dele." />
          </div>
        </div>
      </section>

      <section style={{ padding: "80px 0", background: "var(--bg-subtle)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
        <div className="container">
          <p className="eyebrow" style={{ marginBottom: 12 }}>Por que vale</p>
          <h2 style={{ fontSize: "clamp(1.7rem, 3.6vw, 2.3rem)", fontWeight: 800, lineHeight: 1.1, maxWidth: 620 }}>
            Venda sem a operação de varejo
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 22, marginTop: 40 }}>
            <Valor Icon={Wind} titulo="Pedido com instalação junto"
              desc="O aparelho já sai com instalador contratado — menos devolução por instalação malfeita." />
            <Valor Icon={Bolt} titulo="Sem custo de aquisição"
              desc="Você não paga anúncio nem monta loja. A demanda vem do cliente que já está comprando." />
            <Valor Icon={Shield} titulo="Seu custo é confidencial"
              desc="O que você cobra da FrioHub nunca aparece para o cliente nem para outra distribuidora." />
            <Valor Icon={Check} titulo="Você decide o que publicar"
              desc="Catálogo, estoque e prazo são seus. Ativa e desativa produto quando quiser." />
          </div>
        </div>
      </section>

      <section style={{ background: "var(--brand-ink)", color: "#eaf3f5" }}>
        <div className="container" style={{ padding: "64px 24px", display: "flex", flexWrap: "wrap", gap: 28, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ maxWidth: 520 }}>
            <h2 style={{ fontSize: "clamp(1.6rem, 3.6vw, 2.2rem)", fontWeight: 800, lineHeight: 1.1, marginBottom: 12 }}>
              Atendemos {REGIAO_LABEL}
            </h2>
            <p style={{ fontSize: "1.05rem", color: "#b8d3da", lineHeight: 1.55 }}>
              Estamos abrindo o catálogo para distribuidoras da região. O cadastro passa por uma
              verificação da nossa equipe antes de os produtos entrarem no ar.
            </p>
          </div>
          <Link href="/signup?role=distribuidora" className="btn btn-onbrand btn-lg" style={{ gap: 8, flexShrink: 0 }}>
            Quero cadastrar <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}

function Passo({ n, titulo, desc }: { n: string; titulo: string; desc: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: 14, fontWeight: 600, color: "var(--cool)", marginBottom: 12 }}>{n}</div>
      <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: 7 }}>{titulo}</h3>
      <p style={{ color: "var(--ink-soft)", fontSize: 15, lineHeight: 1.6 }}>{desc}</p>
    </div>
  );
}

function Valor({ Icon, titulo, desc }: { Icon: (p: { size?: number }) => React.ReactElement; titulo: string; desc: string }) {
  return (
    <div>
      <span style={{ display: "grid", placeItems: "center", width: 46, height: 46, borderRadius: 12, background: "var(--cool)", color: "#fff", marginBottom: 16 }}>
        <Icon size={22} />
      </span>
      <h3 style={{ fontSize: "1.12rem", fontWeight: 700, marginBottom: 6 }}>{titulo}</h3>
      <p style={{ color: "var(--ink-soft)", fontSize: 15, lineHeight: 1.55 }}>{desc}</p>
    </div>
  );
}
