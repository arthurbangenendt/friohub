// Utilitários de CEP (ViaCEP) e geolocalização (BigDataCloud) — client-side, sem chave.

export type CepInfo = {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export function formatarCep(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

// Busca endereço a partir do CEP (ViaCEP). Retorna null se inválido/não encontrado.
export async function buscarCep(cepRaw: string): Promise<CepInfo | null> {
  const cep = cepRaw.replace(/\D/g, "");
  if (cep.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!r.ok) return null;
    const d = await r.json();
    if (d.erro) return null;
    return {
      cep: d.cep ?? cepRaw,
      logradouro: d.logradouro ?? "",
      bairro: d.bairro ?? "",
      cidade: d.localidade ?? "",
      uf: d.uf ?? "",
    };
  } catch {
    return null;
  }
}

export type GeoResultado =
  | { status: "ok"; cidade: string; uf: string }
  | { status: "negado" }
  | { status: "erro" }
  | { status: "indisponivel" };

export type GeoDetalhadoResultado =
  | {
      status: "ok";
      cidade: string;
      uf: string;
      cep: string;
      latitude: number;
      longitude: number;
      accuracy: number | null;
    }
  | { status: "negado" }
  | { status: "erro" }
  | { status: "indisponivel" };

export type GeoCoordenadas = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

// Além de cidade/UF, devolve a coordenada necessária para desenhar e persistir
// o raio. Mesmo se o reverse-geocode falhar, a posição do navegador continua
// válida e o profissional pode informar a cidade manualmente.
export async function detectarLocalizacaoDetalhada(
  aoEncontrarCoordenadas?: (coordenadas: GeoCoordenadas) => void,
): Promise<GeoDetalhadoResultado> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return { status: "indisponivel" };
  }

  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          const coordenadas = {
            latitude,
            longitude,
            accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
          };
          // Libera o mapa assim que o navegador responde. O nome da cidade pode
          // chegar alguns segundos depois sem bloquear a visualização.
          aoEncontrarCoordenadas?.(coordenadas);
          const controller = new AbortController();
          const reverseGeocodeTimeout = window.setTimeout(() => controller.abort(), 5000);
          try {
            const r = await fetch(
              `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=pt`,
              { signal: controller.signal },
            );
            if (!r.ok) throw new Error("reverse-geocode indisponível");
            const d = await r.json();
            const cidade = d.city || d.locality || d.localityInfo?.administrative?.[3]?.name || "";
            const uf = (d.principalSubdivisionCode || "").replace("BR-", "");
            resolve({
              status: "ok",
              cidade,
              uf,
              cep: String(d.postcode ?? ""),
              latitude,
              longitude,
              accuracy: coordenadas.accuracy,
            });
          } catch {
            resolve({
              status: "ok",
              cidade: "",
              uf: "",
              cep: "",
              latitude,
              longitude,
              accuracy: coordenadas.accuracy,
            });
          } finally {
            window.clearTimeout(reverseGeocodeTimeout);
          }
        },
        (erro) => resolve({ status: erro.code === erro.PERMISSION_DENIED ? "negado" : "erro" }),
        // Um raio de serviço não exige precisão de GPS. No desktop, pedir alta
        // precisão pode deixar o navegador esperando por um sensor inexistente.
        { timeout: 15000, enableHighAccuracy: false, maximumAge: 300000 },
      );
    } catch {
      resolve({ status: "erro" });
    }
  });
}

// Pede a localização do navegador e faz reverse-geocode (BigDataCloud, sem chave).
export async function detectarLocalizacao(): Promise<GeoResultado> {
  const resultado = await detectarLocalizacaoDetalhada();
  if (resultado.status !== "ok") return resultado;
  return { status: "ok", cidade: resultado.cidade, uf: resultado.uf };
}
