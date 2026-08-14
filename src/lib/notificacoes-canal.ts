/* Contrato de canal de entrega.
 *
 * Estado atual: existe UM canal implementado, o inbox dentro do app, e ele não
 * precisa de entrega — a tela lê `notification_outbox` direto. Este módulo
 * existe para o próximo canal (e-mail) não precisar redescobrir duas coisas: o
 * recorte correto da fila e o texto que o usuário já viu no app.
 *
 * Não há registro de canais nem despachante aqui de propósito. Enquanto o
 * consumidor não existe, uma engrenagem vazia só daria a impressão de que o
 * envio está pronto — que é exatamente o problema que a tela de preferências
 * tinha antes de ganhar o aviso de canal inativo.
 *
 * ---------------------------------------------------------------------------
 * COMO LIGAR O E-MAIL, quando for a hora
 * ---------------------------------------------------------------------------
 * 1. O consumidor roda FORA do app Next (Edge Function ou worker) com
 *    `service_role`: `notification_outbox` revoga insert/update/delete de
 *    `authenticated`, e atualizar `status` é obrigatório.
 *
 * 2. O recorte da fila é, obrigatoriamente:
 *
 *      select * from notification_outbox
 *       where status in ('pending', 'failed')
 *         and email_allowed            -- NÃO OMITA: é o respeito à preferência
 *         and available_at <= now()
 *       order by created_at
 *       for update skip locked;
 *
 *    `email_allowed` é calculado no enfileiramento a partir de
 *    `notification_preferences`. Desde que a outbox virou registro único de
 *    eventos, a tabela contém também linhas de quem NÃO quer e-mail — elas
 *    existem para o inbox. Ignorar essa coluna significa enviar e-mail para
 *    quem pediu para não receber.
 *
 * 3. `status` pertence ao canal e-mail; `read_at` pertence ao inbox. Um não
 *    encosta no outro: e-mail entregue não marca a notificação como lida no app.
 *
 * 4. `dedupe_key` já é único, então reprocessar é seguro. Faça o consumidor
 *    idempotente pelo `id`, e use `attempts` / `last_error` para a política de
 *    nova tentativa; o health check já alerta quando a fila passa de 100
 *    pendentes.
 */

import { paraView, type NotificacaoBruta } from "./notificacoes";

export type MensagemCanal = {
  assunto: string;
  /** Primeira linha do corpo — o mesmo detalhe que o inbox mostra. */
  resumo: string | null;
  /** Caminho interno; o canal precisa prefixar com a URL pública do site. */
  caminho: string | null;
};

/* Deriva a mensagem do MESMO lugar que o inbox usa. É o ponto principal deste
   módulo: se o e-mail montasse o próprio texto, "Sua proposta foi aceita" no
   app viraria "Atualização no orçamento" no e-mail, e ninguém perceberia até um
   usuário reclamar. */
export function montarMensagem(n: NotificacaoBruta): MensagemCanal {
  const v = paraView(n);
  return { assunto: v.titulo, resumo: v.detalhe, caminho: v.href };
}
