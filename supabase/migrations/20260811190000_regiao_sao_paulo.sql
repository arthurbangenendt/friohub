-- Muda a cidade piloto para São Paulo (o negócio é de SP, não de Fortaleza).
insert into public.city_billing_config (cidade, cobranca_ativa)
values ('São Paulo', false)
on conflict (cidade) do nothing;

-- Reaponta profissionais e áreas que estavam em Fortaleza para São Paulo
update public.professionals set cidade = 'São Paulo', estado = 'SP' where cidade = 'Fortaleza';
update public.service_areas set cidade = 'São Paulo' where cidade = 'Fortaleza';
update public.jobs set cidade = 'São Paulo' where cidade = 'Fortaleza';

delete from public.city_billing_config where cidade = 'Fortaleza';
