# Backup e restauração

## Evidência atual

Em 13/08/2026, `npm run db:restore:verify` executou com sucesso um dump lógico dos schemas
`public`, `auth` e `supabase_migrations`, restaurou em banco temporário isolado, comparou contagens e
validou funções críticas, ledger e constraints. O banco temporário foi removido ao final.

`pg_cron` é single-database no Supabase local; seus quatro jobs críticos são validados no banco de
origem. Realtime e Storage são componentes gerenciados e não entram nesse dump lógico.

## Como repetir localmente

1. Iniciar o Supabase com `supabase start`.
2. Executar `npm run db:restore:verify`.
3. Guardar o resultado no registro da release. Falha bloqueia deploy de migration.

O script só cria e apaga banco com prefixo `friohub_restore_verify_`. Ele nunca restaura sobre
`postgres`.

## Gates ainda abertos

- Confirmar política de backup do plano Supabase escolhido, retenção e região.
- Definir RPO e RTO contratuais. Proposta inicial: RPO ≤ 24 h e RTO ≤ 4 h no piloto; menores se
  pagamentos forem ativados.
- Executar restore de snapshot remoto com volume semelhante ao real em staging.
- Testar recuperação de objetos privados do Storage e segredos/configuração das Edge Functions.
- Registrar responsável, evidência trimestral e procedimento de promoção após o restore.

Sem esses itens, o projeto tem restauração lógica local comprovada, mas não recuperação de desastre
de produção comprovada.

