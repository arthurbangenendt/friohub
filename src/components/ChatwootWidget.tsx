"use client";

import Script from "next/script";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const BASE_URL = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL;
const WEBSITE_TOKEN = process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN;

declare global {
  interface Window {
    chatwootSDK?: { run: (config: { websiteToken: string; baseUrl: string }) => void };
    $chatwoot?: { toggleBubbleVisibility: (state: "show" | "hide") => void };
  }
}

/* Painel e admin já têm o chat próprio cliente↔profissional — o widget é só
   para visitante do site público. */
function escondidoEm(pathname: string | null) {
  if (!pathname) return false;
  return pathname.startsWith("/painel") || pathname.startsWith("/admin");
}

/* `window.$chatwoot` pode existir antes do balão (o elemento que
   `toggleBubbleVisibility` manipula) estar de fato no DOM — o evento
   `chatwoot:ready` reduz a janela, mas não fecha ela por completo. Sem o
   catch, essa corrida interna do sdk.js de terceiro lança um TypeError que
   sobe até o global-error.tsx e derruba a página inteira por causa só da
   visibilidade do balão do chat público. */
function alternarBalao(estado: "show" | "hide") {
  try {
    window.$chatwoot?.toggleBubbleVisibility(estado);
  } catch {
    /* console.warn, não console.error: o Next mostra TODO console.error no
       overlay de dev como se fosse crash, mesmo já capturado aqui — e isso
       não é um crash, é o widget de terceiro numa corrida interna conhecida
       (ver comentário acima). */
    console.warn("[chatwoot] falha ao alternar o balão — provável corrida interna do sdk.js");
  }
}

export function ChatwootWidget() {
  const pathname = usePathname();

  useEffect(() => {
    if (!BASE_URL || !WEBSITE_TOKEN) return;
    const estado = escondidoEm(pathname) ? "hide" : "show";
    alternarBalao(estado);
    /* $chatwoot só existe depois desse evento — run() só enfileira a inicialização,
       então a primeira troca de visibilidade (antes do evento) não tem efeito
       sozinha; este listener cobre esse caso. */
    const aoFicarPronto = () => alternarBalao(estado);
    window.addEventListener("chatwoot:ready", aoFicarPronto);
    return () => window.removeEventListener("chatwoot:ready", aoFicarPronto);
  }, [pathname]);

  if (!BASE_URL || !WEBSITE_TOKEN) return null;

  return (
    <Script
      src={`${BASE_URL}/packs/js/sdk.js`}
      strategy="afterInteractive"
      onLoad={() => {
        /* `run()` é código de terceiro (Chatwoot self-hosted) — se o widget
           estiver indisponível ou limitado por rate limit no Cloudflare na
           frente dele, ele pode lançar depois de carregado. Sem o catch,
           esse erro sobe até o global-error.tsx e derruba a página inteira
           por causa só do widget de chat público. */
        try {
          window.chatwootSDK?.run({ websiteToken: WEBSITE_TOKEN, baseUrl: BASE_URL });
        } catch {
          console.warn("[chatwoot] falha ao iniciar o widget");
        }
      }}
      onError={() => {
        console.warn("[chatwoot] sdk.js não carregou");
      }}
    />
  );
}
