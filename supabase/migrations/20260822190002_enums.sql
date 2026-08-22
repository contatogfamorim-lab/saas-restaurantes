-- =============================================================================
-- 0002 — Enums de domínio
-- =============================================================================
-- Enum em vez de text+CHECK: o `supabase gen types typescript` transforma cada
-- um em union type, então o TypeScript passa a rejeitar estado inválido em
-- tempo de compilação — a mesma regra valendo no banco e no app.
-- =============================================================================

create type public.staff_role as enum (
  'owner', 'manager', 'waiter', 'kitchen', 'cashier'
);

create type public.station as enum ('cozinha', 'bar');

create type public.session_status as enum (
  'open', 'closing', 'closed', 'cancelled'
);

create type public.order_source as enum ('guest', 'waiter');

create type public.order_status as enum (
  'pending_approval', 'approved', 'partially_approved', 'rejected', 'cancelled'
);

create type public.order_item_status as enum (
  'pending', 'queued', 'preparing', 'ready', 'delivered', 'cancelled', 'out_of_stock'
);

create type public.rejection_reason as enum (
  'acabou', 'cliente_desistiu', 'erro_no_pedido'
);

create type public.release_reason as enum (
  'cliente_foi_embora_sem_pagar', 'mesa_aberta_por_engano', 'cortesia_da_casa', 'outro'
);

create type public.waiter_call_type as enum ('call_waiter', 'request_bill');

create type public.waiter_call_status as enum ('open', 'resolved', 'cancelled');

create type public.payment_method as enum (
  'pix', 'credito', 'debito', 'dinheiro', 'voucher'
);

create type public.menu_event_type as enum (
  'view', 'add_to_cart', 'remove_from_cart'
);

create type public.promotion_status as enum (
  'draft', 'active', 'paused', 'expired'
);

create type public.discount_type as enum (
  'fixed_price', 'percent', 'buy_x_pay_y', 'free_item'
);

create type public.promotion_applies_to as enum ('auto', 'staff_only');

create type public.promotion_target_type as enum ('product', 'category');

create type public.menu_layout_status as enum ('draft', 'published');

create type public.menu_block_type as enum (
  'category', 'product', 'featured_group', 'banner', 'text', 'combo', 'drink_grid', 'spacer'
);

create type public.audit_actor_type as enum ('staff', 'guest', 'system');
