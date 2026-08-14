/* Fotos do atendimento.
 *
 * O bucket `service-evidence` é privado. A política de storage já permite que o
 * cliente do serviço leia os objetos cuja segunda pasta do caminho é o id do
 * job (ver 20260813200238_ux_service_execution.sql), então a URL assinada é
 * gerada com a sessão de quem está vendo — não com chave de serviço.
 *
 * O prazo curto é intencional: a URL assinada vaza sozinha se for copiada, e
 * uma hora é mais do que suficiente para carregar a página. */
const VALIDADE_SEGUNDOS = 3600;

import { createClient } from "@/lib/supabase/server";

export async function Evidencias({ caminhos }: { caminhos: string[] }) {
  if (caminhos.length === 0) return null;

  const supabase = await createClient();
  const { data } = await supabase.storage
    .from("service-evidence")
    .createSignedUrls(caminhos, VALIDADE_SEGUNDOS);

  /* Um caminho que falhou ao assinar (arquivo removido, permissão negada) sai
     da lista em silêncio: uma imagem quebrada dá a impressão de que o
     profissional não documentou o serviço. */
  const urls = (data ?? []).filter((d) => d.signedUrl && !d.error).map((d) => d.signedUrl!);
  if (urls.length === 0) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 8px" }}>
        {urls.length === 1 ? "1 foto registrada pelo profissional" : `${urls.length} fotos registradas pelo profissional`}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        {urls.map((url, i) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "block", aspectRatio: "4 / 3", borderRadius: 11, overflow: "hidden", border: "1px solid var(--line)", background: "var(--surface-2)" }}
          >
            {/* `<img>` puro, e não `next/image`: a URL é assinada e expira, então
                otimizá-la no servidor geraria cache de um endereço que morre. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`Foto ${i + 1} do atendimento`}
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </a>
        ))}
      </div>
    </div>
  );
}
