"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Shield } from "@/components/icons";

type Reputacao = { totalEntregues: number; taxaNoPrazo: number | null; verificada: boolean };

// Vários produtos do mesmo distribuidor aparecem na mesma página do
// catálogo — sem cache, cada card repetiria a mesma chamada.
const cache = new Map<string, Promise<Reputacao | null>>();

async function carregar(distributorId: string): Promise<Reputacao | null> {
  const supabase = createClient();
  try {
    const { data } = await supabase.rpc("reputacao_distribuidora", { p_distributor_id: distributorId });
    const linha = Array.isArray(data) ? data[0] : null;
    if (!linha) return null;
    return {
      totalEntregues: linha.total_entregues ?? 0,
      taxaNoPrazo: linha.taxa_no_prazo === null ? null : Number(linha.taxa_no_prazo),
      verificada: !!linha.verificada,
    };
  } catch {
    return null;
  }
}

function buscar(distributorId: string): Promise<Reputacao | null> {
  const existente = cache.get(distributorId);
  if (existente) return existente;
  const p = carregar(distributorId);
  cache.set(distributorId, p);
  return p;
}

/* Selo automático — sem avaliação por texto, sem tabela nova. "Verificado"
 * já existia (verification_status) mas não tinha nenhum componente visual
 * pra distribuidora em lugar nenhum público. "% no prazo" só aparece com
 * pelo menos 5 entregas — amostra pequena não vira sinal de confiança. */
export function SeloDistribuidora({ distributorId }: { distributorId: string }) {
  const [rep, setRep] = useState<Reputacao | null>(null);

  useEffect(() => {
    let vivo = true;
    buscar(distributorId).then((r) => { if (vivo) setRep(r); });
    return () => { vivo = false; };
  }, [distributorId]);

  if (!rep) return null;

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-faint)" }}>
      {rep.verificada && <Shield size={12} />}
      {rep.totalEntregues >= 5 && rep.taxaNoPrazo !== null && (
        <span>{rep.taxaNoPrazo}% no prazo</span>
      )}
    </span>
  );
}
