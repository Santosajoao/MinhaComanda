-- Sistema de comandas: schema inicial
CREATE TABLE establishments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  number_pad int NOT NULL DEFAULT 5 CHECK (number_pad BETWEEN 1 AND 12),
  number_mode text NOT NULL DEFAULT 'auto' CHECK (number_mode IN ('auto','manual')),
  number_min int NOT NULL DEFAULT 1,
  number_max int NOT NULL DEFAULT 1000,
  number_reuse boolean NOT NULL DEFAULT true,
  service_fee_bps int NOT NULL DEFAULT 0 CHECK (service_fee_bps BETWEEN 0 AND 3000),
  max_discount_bps int NOT NULL DEFAULT 1000 CHECK (max_discount_bps BETWEEN 0 AND 10000),
  cpf_policy text NOT NULL DEFAULT 'optional' CHECK (cpf_policy IN ('required','optional','none')),
  allow_partial_payment boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (number_min <= number_max)
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES establishments(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','encerrado')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES establishments(id),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','gerente','recepcao','atendente','caixa','supervisor','auditor')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_users_email ON users (lower(email));

CREATE TABLE terminals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES establishments(id),
  name text NOT NULL,
  sector text NOT NULL DEFAULT 'geral',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consumers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES establishments(id),
  name text NOT NULL,
  cpf_enc text,
  cpf_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_consumers_cpf ON consumers (establishment_id, cpf_hash) WHERE cpf_hash IS NOT NULL;

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES establishments(id),
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Geral',
  unit text NOT NULL DEFAULT 'un',
  price_cents int NOT NULL CHECK (price_cents >= 0),
  promo_price_cents int CHECK (promo_price_cents >= 0),
  promo_starts_at timestamptz,
  promo_ends_at timestamptz,
  sectors text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (establishment_id, code),
  CHECK (promo_price_cents IS NULL OR (promo_starts_at IS NOT NULL AND promo_ends_at IS NOT NULL AND promo_ends_at > promo_starts_at))
);

CREATE TABLE product_prices (
  id bigserial PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id),
  price_cents int NOT NULL,
  promo_price_cents int,
  promo_starts_at timestamptz,
  promo_ends_at timestamptz,
  changed_by uuid REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES establishments(id),
  event_id uuid REFERENCES events(id),
  consumer_id uuid REFERENCES consumers(id),
  number text NOT NULL,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN
    ('aberta','em_conferencia','aguardando_pagamento','parcialmente_paga','paga','encerrada','bloqueada','cancelada')),
  service_fee_bps int NOT NULL DEFAULT 0,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid NOT NULL REFERENCES users(id),
  opened_terminal uuid REFERENCES terminals(id),
  checked_by uuid REFERENCES users(id),
  checked_at timestamptz,
  statement_confirmed_at timestamptz,
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  close_exception text,
  reopen_count int NOT NULL DEFAULT 0,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- RN-03: um número não pode identificar duas comandas ativas no mesmo estabelecimento
CREATE UNIQUE INDEX uq_tabs_active_number ON tabs (establishment_id, number)
  WHERE status NOT IN ('encerrada','cancelada');
CREATE INDEX ix_tabs_est_status ON tabs (establishment_id, status);
CREATE INDEX ix_tabs_number ON tabs (establishment_id, number);
CREATE INDEX ix_tabs_event ON tabs (event_id);

CREATE TABLE tab_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_id uuid NOT NULL REFERENCES tabs(id),
  product_id uuid NOT NULL REFERENCES products(id),
  description text NOT NULL,
  category text NOT NULL,
  quantity int NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  unit_price_cents int NOT NULL CHECK (unit_price_cents >= 0),
  subtotal_cents int NOT NULL CHECK (subtotal_cents >= 0),
  status text NOT NULL DEFAULT 'valido' CHECK (status IN ('valido','cancelado')),
  note text,
  batch_key text NOT NULL,
  line_no int NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  terminal_id uuid REFERENCES terminals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users(id),
  cancel_reason text,
  UNIQUE (batch_key, line_no),
  CHECK (subtotal_cents = quantity * unit_price_cents)
);
CREATE INDEX ix_items_tab ON tab_items (tab_id);
CREATE INDEX ix_items_created ON tab_items (created_at);

CREATE TABLE tab_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_id uuid NOT NULL REFERENCES tabs(id),
  item_id uuid REFERENCES tab_items(id),
  type text NOT NULL CHECK (type IN ('cancelamento','desconto')),
  amount_cents int NOT NULL CHECK (amount_cents >= 0),
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revoke_reason text
);
CREATE INDEX ix_adj_tab ON tab_adjustments (tab_id);

CREATE TABLE cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES establishments(id),
  user_id uuid NOT NULL REFERENCES users(id),
  terminal_id uuid REFERENCES terminals(id),
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','fechado')),
  opening_cents int NOT NULL DEFAULT 0 CHECK (opening_cents >= 0),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  counted_cents int,
  expected_cents int,
  difference_cents int,
  notes text
);
CREATE UNIQUE INDEX uq_cash_open_per_user ON cash_sessions (user_id) WHERE status = 'aberto';

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_id uuid NOT NULL REFERENCES tabs(id),
  cash_session_id uuid REFERENCES cash_sessions(id),
  method text NOT NULL CHECK (method IN ('dinheiro','pix','debito','credito','outro')),
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','confirmado','recusado','cancelado','estornado')),
  reference text,
  cash_received_cents int,
  idempotency_key text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  terminal_id uuid REFERENCES terminals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES users(id),
  status_reason text
);
CREATE INDEX ix_pay_tab ON payments (tab_id);
CREATE INDEX ix_pay_session ON payments (cash_session_id);

CREATE TABLE payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id),
  cash_session_id uuid REFERENCES cash_sessions(id),
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  establishment_id uuid,
  user_id uuid,
  user_name text,
  terminal_id uuid,
  type text NOT NULL,
  entity text,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_est_created ON audit_events (establishment_id, created_at DESC);
CREATE INDEX ix_audit_type ON audit_events (type);

-- ===== Proteções de integridade no banco =====
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registro histórico protegido: % em % não é permitido', TG_OP, TG_TABLE_NAME;
END $$;

CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER trg_items_nodelete BEFORE DELETE ON tab_items FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER trg_payments_nodelete BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER trg_adj_nodelete BEFORE DELETE ON tab_adjustments FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER trg_refunds_immutable BEFORE UPDATE OR DELETE ON payment_refunds FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER trg_tabs_nodelete BEFORE DELETE ON tabs FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- RN-05: preço, quantidade e descrição de um lançamento nunca mudam depois de gravados
CREATE FUNCTION items_immutable_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tab_id <> OLD.tab_id OR NEW.product_id <> OLD.product_id OR NEW.description <> OLD.description
     OR NEW.quantity <> OLD.quantity OR NEW.unit_price_cents <> OLD.unit_price_cents
     OR NEW.subtotal_cents <> OLD.subtotal_cents OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Dados financeiros de um lançamento não podem ser alterados; registre um cancelamento/ajuste';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_items_immutable BEFORE UPDATE ON tab_items FOR EACH ROW EXECUTE FUNCTION items_immutable_fields();

-- RN-10: só é possível lançar itens em comandas abertas (reforço no banco)
CREATE FUNCTION items_only_open_tab() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM tabs WHERE id = NEW.tab_id;
  IF s IS DISTINCT FROM 'aberta' THEN
    RAISE EXCEPTION 'Comanda não está aberta para novos lançamentos (estado: %)', s;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_items_open_tab BEFORE INSERT ON tab_items FOR EACH ROW EXECUTE FUNCTION items_only_open_tab();

-- Pagamentos: valor, método e comanda são imutáveis
CREATE FUNCTION payments_immutable_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tab_id <> OLD.tab_id OR NEW.amount_cents <> OLD.amount_cents OR NEW.method <> OLD.method THEN
    RAISE EXCEPTION 'Valor, método e comanda de um pagamento não podem ser alterados';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payments_immutable BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payments_immutable_fields();

-- Fonte única da verdade para totais da comanda (RN-06): consumo, pagamento e saldo
CREATE FUNCTION tab_totals(p_tab uuid)
RETURNS TABLE (gross_cents bigint, cancelled_cents bigint, discount_cents bigint, fee_cents bigint,
               net_cents bigint, paid_cents bigint, pending_cents bigint, balance_cents bigint)
LANGUAGE sql STABLE AS $$
  WITH g AS (
    SELECT COALESCE(SUM(subtotal_cents) FILTER (WHERE status = 'valido'), 0)::bigint AS gross,
           COALESCE(SUM(subtotal_cents) FILTER (WHERE status = 'cancelado'), 0)::bigint AS canc
    FROM tab_items WHERE tab_id = p_tab
  ), d AS (
    SELECT COALESCE(SUM(amount_cents), 0)::bigint AS disc
    FROM tab_adjustments WHERE tab_id = p_tab AND type = 'desconto' AND revoked_at IS NULL
  ), p AS (
    SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status = 'confirmado'), 0)::bigint AS paid,
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pendente'), 0)::bigint AS pend
    FROM payments WHERE tab_id = p_tab
  ), t AS (SELECT service_fee_bps AS bps FROM tabs WHERE id = p_tab),
  h AS (
    SELECT g.gross, g.canc, LEAST(d.disc, g.gross) AS disc,
           ROUND((g.gross - LEAST(d.disc, g.gross)) * t.bps / 10000.0)::bigint AS fee, p.paid, p.pend
    FROM g, d, p, t
  )
  SELECT h.gross, h.canc, h.disc, h.fee, (h.gross - h.disc + h.fee), h.paid, h.pend,
         (h.gross - h.disc + h.fee - h.paid)
  FROM h
$$;
