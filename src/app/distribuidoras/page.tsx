import { createClient } from "@/lib/supabase/server";
import { SiteHeader, SiteFooter } from "@/components/site";
import { REGIAO_LABEL } from "@/lib/regiao";
import { Bolt, Check, Shield, Wind } from "@/components/icons";
import { FormularioInteresse } from "./FormularioInteresse";

export const metadata = {
  title: "Venda pela FrioHub — para distribuidoras de climatização",
  description:
    "Cadastre seu catálogo e receba pedidos com instalação já contratada. Você despacha, a FrioHub cuida da venda e do cliente.",
};

const mono = "var(--font-geist-mono), ui-monospace, monospace";
const h2: React.CSSProperties = { fontSize: "clamp(1.7rem, 3.6vw, 2.3rem)", fontWeight: 800, lineHeight: 1.1, maxWidth: 620, marginTop: 12 };

/* Landing de captação do terceiro lado. Espelha /parceiros de propósito: sem uma
   porta de entrada própria, não há como recrutar distribuidora — e sem catálogo
   não existe a receita de equipamento.

   Cadastro fica sob controle do admin (decisão do time) — por isso não há
   link direto pra /signup?role=distribuidora aqui; o CTA é o formulário de
   interesse (ver FormularioInteresse.tsx e distributor_interest). */
export default async function DistribuidorasPage() {
  const supabase = await createClient();

  // Números reais. Se ainda não há base, o bloco some — mesmo critério de /parceiros.
  const { count: numDistribuidoras } = await supabase
    .from("distributors")
    .select("id", { count: "exact", head: true })
    .eq("ativo", true);
  const { count: numProdutos } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("ativo", true);
  const temNumeros = (numDistribuidoras ?? 0) > 0 || (numProdutos ?? 0) > 0;

  return (
    <>
      <SiteHeader />

      <section style={{ background: "var(--brand-ink)", color: "#eaf3f5" }}>
        <div className="container" style={{ padding: "84px 24px 72px", maxWidth: 820 }}>
          <p className="eyebrow" style={{ color: "#7fd0e0", marginBottom: 16 }}>Para distribuidoras</p>
          <h1 style={{ fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 800, lineHeight: 1.06, marginBottom: 18 }}>
            Seu estoque vendendo com a instalação já contratada.
          </h1>
          <p style={{ fontSize: "1.15rem", color: "#b8d3da", lineHeight: 1.55, maxWidth: 620, marginBottom: 32 }}>
            Na FrioHub o cliente escolhe o aparelho e o instalador no mesmo lugar. Você recebe o pedido
            pronto, com endereço e prazo — sem vitrine para montar, sem anúncio para pagar, sem
            atendimento para fazer.
          </p>
          <FormularioInteresse />
        </div>
      </section>

      {temNumeros && (
        <section className="container" style={{ padding: "40px 24px 0" }}>
          <div className="parc-grid">
            {(numDistribuidoras ?? 0) > 0 && <Numero valor={String(numDistribuidoras)} label="Distribuidoras ativas" />}
            {(numProdutos ?? 0) > 0 && <Numero valor={String(numProdutos)} label="Produtos no catálogo" />}
          </div>
        </section>
      )}

      <section id="como-funciona" style={{ padding: "80px 0" }}>
        <div className="container">
          <p className="eyebrow" style={{ marginBottom: 12 }}>Como funciona</p>
          <h2 style={h2}>
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
          <h2 style={h2}>
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

      <section className="container" style={{ padding: "64px 24px" }}>
        <span className="eyebrow">Dúvidas</span>
        <h2 style={h2}>Perguntas frequentes</h2>
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 2 }}>
          <Faq q="Como o preço ao cliente é calculado?" a="Você informa o seu custo; a FrioHub aplica uma margem fixa por cima pra chegar no preço de vitrine. Seu custo nunca é exposto — nem pro cliente, nem pra outra distribuidora." />
          <Faq q="Preciso ter loja física ou anúncio próprio?" a="Não. A demanda vem do cliente que já está pedindo um serviço na plataforma — você só cadastra o catálogo e cuida do despacho." />
          <Faq q="Como funciona a verificação?" a="Toda distribuidora nova passa por análise da equipe FrioHub antes do catálogo entrar no ar. Mudar dado cadastral depois de verificado manda de volta pra análise, automaticamente." />
          <Faq q="Como e quando eu recebo?" a="O repasse aparece no seu painel assim que o pedido é confirmado — cada etapa (confirmado, faturado, enviado, entregue) fica registrada e visível pra você e pro cliente." />
          <Faq q="Posso desativar um produto sem estoque?" a="Sim, na hora. Produto sem estoque sai da busca imediatamente — ninguém consegue pedir o que você não tem." />
        </div>
      </section>

      <section style={{ background: "var(--brand-ink)", color: "#eaf3f5" }}>
        <div className="container" style={{ padding: "64px 24px", display: "flex", flexWrap: "wrap", gap: 28, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ maxWidth: 520 }}>
            <h2 style={{ fontSize: "clamp(1.6rem, 3.6vw, 2.2rem)", fontWeight: 800, lineHeight: 1.1, marginBottom: 12 }}>
              Atendemos {REGIAO_LABEL}
            </h2>
            <p style={{ fontSize: "1.05rem", color: "#b8d3da", lineHeight: 1.55 }}>
              Estamos abrindo o catálogo para distribuidoras da região. Deixe seu contato acima —
              nossa equipe fala com você pra seguir com o cadastro.
            </p>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}

function Numero({ valor, label }: { valor: string; label: string }) {
  return (
    <div className="card" style={{ padding: "22px 24px" }}>
      <div className="parc-num">{valor}</div>
      <div style={{ fontSize: 13.5, color: "var(--ink-faint)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function Passo({ n, titulo, desc }: { n: string; titulo: string; desc: string }) {
  return (
    <div>
      <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: "var(--cool)", marginBottom: 12 }}>{n}</div>
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

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details style={{ borderBottom: "1px solid var(--line)", padding: "16px 0" }}>
      <summary style={{ cursor: "pointer", fontWeight: 650, fontSize: 15.5, display: "flex", justifyContent: "space-between", gap: 16, listStyle: "none" }}>
        {q}
      </summary>
      <p style={{ margin: "10px 0 0", fontSize: 14.5, color: "var(--ink-soft)", lineHeight: 1.65 }}>{a}</p>
    </details>
  );
}
