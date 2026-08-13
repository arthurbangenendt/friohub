create index idx_rate_limit_buckets_expiry
  on public.rate_limit_buckets (expires_at);

comment on index public.idx_rate_limit_buckets_expiry is
  'Evita varredura completa durante a retenção executada pelo health worker.';
