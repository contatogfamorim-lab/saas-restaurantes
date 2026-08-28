-- =============================================================================
-- 0057 — A view de progresso passa a dizer QUEM criou a campanha
-- =============================================================================
-- A tela de campanhas precisa somar quantas mensagens cada aviso automático já
-- mandou, e a view não expunha `trigger_kind`. Sem isso a contagem por gatilho
-- só existiria com uma segunda consulta — que eu cheguei a escrever, e que
-- devolveria os mesmos dados por outro caminho.
--
-- `create or replace view` não renomeia nem reordena coluna: só ACRESCENTA no
-- fim. Por isso a nova entra por último, e não perto de `status`, onde ficaria
-- melhor de ler.
-- =============================================================================
create or replace view public.campanhas_com_progresso
with (security_invoker = true) as
  select
    c.id,
    c.restaurant_id,
    c.titulo,
    c.corpo,
    c.status,
    c.scheduled_at,
    c.next_send_at,
    c.started_at,
    c.finished_at,
    c.last_error,
    c.created_at,
    count(t.id)                                          as total,
    count(*) filter (where t.status = 'sent')            as enviados,
    count(*) filter (where t.status = 'pending')         as pendentes,
    count(*) filter (where t.status = 'failed')          as falharam,
    count(*) filter (where t.status = 'skipped')         as pulados,
    -- NULL = escrita por uma pessoa. É o que separa "campanha da casa" de
    -- "aviso que o sistema mandou sozinho", e a tela precisa da diferença.
    c.trigger_kind
  from public.message_campaigns c
  left join public.message_campaign_targets t on t.campaign_id = c.id
  group by c.id;

grant select on public.campanhas_com_progresso to authenticated;
