import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Cabecalho, wrap } from "../shared";
import { CalculadoraBtu } from "./CalculadoraBtu";
import { FerramentasEditor, type Ferramenta } from "./FerramentasEditor";
import { PlanoBloqueado } from "@/components/ui/PlanoBloqueado";

/* Referências de bancada. Valores usuais de mercado para consulta rápida — não
   substituem o manual do fabricante nem a norma, e a tela diz isso. */
const GASES = [
  { gas: "R-410A", uso: "Split residencial e comercial atual", pressaoAlta: "380–450", pressaoBaixa: "110–130", obs: "Mistura — carga sempre por líquido" },
  { gas: "R-32", uso: "Linha nova, mais eficiente", pressaoAlta: "380–450", pressaoBaixa: "110–130", obs: "Levemente inflamável (A2L)" },
  { gas: "R-22", uso: "Equipamento antigo", pressaoAlta: "220–250", pressaoBaixa: "60–75", obs: "Em descontinuação no Brasil" },
  { gas: "R-134a", uso: "Chiller e automotivo", pressaoAlta: "150–180", pressaoBaixa: "25–35", obs: "Não usar em split residencial" },
];

const DISJUNTORES = [
  { btu: "7.000 – 9.000", corrente: "10 A", cabo: "1,5 mm²" },
  { btu: "12.000", corrente: "16 A", cabo: "2,5 mm²" },
  { btu: "18.000", corrente: "20 A", cabo: "2,5 mm²" },
  { btu: "24.000", corrente: "25 A", cabo: "4,0 mm²" },
  { btu: "30.000 – 36.000", corrente: "32 A", cabo: "6,0 mm²" },
];

const CHECKLIST_PMOC = [
  "Registro do plano com responsável técnico identificado",
  "Inventário dos equipamentos com localização e capacidade",
  "Periodicidade definida por tipo de componente",
  "Limpeza de filtros, serpentinas e bandeja",
  "Verificação de dreno e ausência de água acumulada",
  "Medição de pressões e temperatura de insuflamento",
  "Registro de cada intervenção com data e responsável",
  "Relatório disponível para a vigilância sanitária",
];

export default async function FerramentasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "profissional") redirect("/painel");

  const { data: ferramentasLiberado } = await supabase.rpc("plano_permite", {
    p_professional_id: user.id,
    p_feature: "ferramentas",
  });
  if (!ferramentasLiberado) {
    return (
      <div style={wrap}>
        <Cabecalho eyebrow="Bancada" titulo="Ferramentas" />
        <PlanoBloqueado
          titulo="Ferramentas é do plano Essencial"
          descricao="Seu inventário de ferramentas com valor de compra puxando despesa automática, mais as referências técnicas de bancada. Faça upgrade para liberar."
        />
      </div>
    );
  }

  const { data: ferramentasData } = await supabase
    .from("professional_tools")
    .select("id, name, category, brand, model, notes, quantity, purchase_price, expense_id, acquired_on")
    .order("created_at", { ascending: false });
  const ferramentas = ((ferramentasData ?? []) as Ferramenta[]).map((item) => ({
    ...item,
    purchase_price: item.purchase_price === null ? null : Number(item.purchase_price),
  }));

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 6px" }}>Ferramentas</h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 28px" }}>
        Organize seu inventário e acesse referências rápidas para a visita técnica.
      </p>

      <FerramentasEditor inicial={ferramentas} />

      <div style={{ margin: "34px 0 14px" }}>
        <p className="eyebrow">Apoio técnico</p>
        <h2 style={{ fontSize: "1.35rem", fontWeight: 800, marginTop: 4 }}>Referências de campo</h2>
      </div>

      <section className="card" style={{ padding: 24 }}>
        <h2 style={h2}>Calculadora de carga térmica</h2>
        <p style={sub}>A mesma que o cliente usa ao abrir o pedido — confira a capacidade no local.</p>
        <CalculadoraBtu />
      </section>

      <section className="card" style={{ padding: 24, marginTop: 16 }}>
        <h2 style={h2}>Gases refrigerantes</h2>
        <p style={sub}>Pressões de trabalho usuais em psi, com o equipamento em regime.</p>
        <Tabela
          colunas={["Gás", "Uso típico", "Alta (psi)", "Baixa (psi)", "Observação"]}
          linhas={GASES.map((g) => [g.gas, g.uso, g.pressaoAlta, g.pressaoBaixa, g.obs])}
        />
      </section>

      <section className="card" style={{ padding: 24, marginTop: 16 }}>
        <h2 style={h2}>Disjuntor e cabo por capacidade</h2>
        <p style={sub}>Referência para circuito exclusivo em 220 V. Confirme sempre na etiqueta do aparelho.</p>
        <Tabela
          colunas={["Capacidade", "Disjuntor", "Seção do cabo"]}
          linhas={DISJUNTORES.map((d) => [d.btu, d.corrente, d.cabo])}
        />
      </section>

      <section className="card" style={{ padding: 24, marginTop: 16 }}>
        <h2 style={h2}>Checklist de PMOC</h2>
        <p style={sub}>
          Plano de Manutenção, Operação e Controle — exigido por lei em ambientes climatizados
          de uso coletivo. É serviço recorrente, não avulso.
        </p>
        <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 7 }}>
          {CHECKLIST_PMOC.map((item) => (
            <li key={item} style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.55 }}>{item}</li>
          ))}
        </ul>
      </section>

      <p style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 20, lineHeight: 1.6 }}>
        Estes valores são referência de mercado para consulta rápida. Não substituem o manual do
        fabricante, a norma aplicável nem a avaliação do responsável técnico.
      </p>
    </div>
  );
}

function Tabela({ colunas, linhas }: { colunas: string[]; linhas: string[][] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 420 }}>
        <thead>
          <tr>
            {colunas.map((c) => (
              <th key={c} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--line)", color: "var(--ink-faint)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", whiteSpace: "nowrap" }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i}>
              {l.map((celula, j) => (
                <td key={j} style={{ padding: "10px", borderBottom: "1px solid var(--line-soft)", color: j === 0 ? "var(--ink)" : "var(--ink-soft)", fontWeight: j === 0 ? 650 : 400 }}>{celula}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: "1.05rem", fontWeight: 700, margin: "0 0 4px" };
const sub: React.CSSProperties = { fontSize: 13, color: "var(--ink-faint)", margin: "0 0 16px", lineHeight: 1.6 };
