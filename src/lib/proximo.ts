/* Destino pós-login.
 *
 * O funil de entrada estava quebrado por um redirecionamento: a pessoa digitava
 * o CEP no hero, ia para `/solicitar?cep=01310100`, a rota exigia login, o CEP
 * era descartado e o `login` terminava num `redirect("/painel")` cravado. O
 * resultado era cair num painel vazio, sem o pedido que ela tinha começado e
 * tendo que digitar o CEP de novo.
 *
 * O valor vem da URL, ou seja, é entrada de terceiro: quem monta o link decide
 * para onde a vítima vai depois de autenticar. Sem validação isso é um open
 * redirect clássico — `/login?next=https://site-falso/login` levaria alguém que
 * acabou de entrar de verdade para um clone pedindo a senha "de novo". Por isso
 * só passa caminho interno.
 */
export function destinoSeguro(bruto: unknown, padrao = "/painel"): string {
  if (typeof bruto !== "string" || bruto.length === 0) return padrao;

  /* Precisa começar com uma única barra. `//evil.com` e `/\evil.com` são
     tratados como URL absoluta pelos navegadores e escapariam de um teste que
     só olhasse o primeiro caractere. */
  if (!bruto.startsWith("/")) return padrao;
  if (bruto.startsWith("//") || bruto.startsWith("/\\")) return padrao;

  /* Barra invertida e caractere de controle são usados para confundir o
     parser de URL; nenhuma rota legítima do FrioHub contém isso. */
  if (/[\\\x00-\x1f]/.test(bruto)) return padrao;

  // Evita um laço: voltar para a própria tela de autenticação não é destino.
  const caminho = bruto.split("?")[0];
  if (caminho === "/login" || caminho === "/signup") return padrao;

  return bruto;
}

/** Monta o link de login preservando para onde a pessoa estava indo. */
export function urlLogin(destino: string, aviso?: string): string {
  const p = new URLSearchParams();
  if (aviso) p.set("aviso", aviso);
  p.set("next", destino);
  return `/login?${p.toString()}`;
}
