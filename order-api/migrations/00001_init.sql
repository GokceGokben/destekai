-- +goose Up
-- Policy embeddings arrive in Phase 3; the extension is enabled with the schema.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE customers (
    id         TEXT PRIMARY KEY CHECK (id ~ '^CUS-[0-9]{4}$'),
    full_name  TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE,
    phone      TEXT NOT NULL,
    city       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    id           TEXT PRIMARY KEY CHECK (id ~ '^DA-[0-9]{6}$'),
    customer_id  TEXT NOT NULL REFERENCES customers (id),
    status       TEXT NOT NULL CHECK (status IN ('preparing', 'shipped', 'delivered', 'cancelled')),
    -- Money is stored in kuruş so that it never passes through a float.
    total_kurus  BIGINT NOT NULL CHECK (total_kurus >= 0),
    placed_at    TIMESTAMPTZ NOT NULL,
    delivered_at TIMESTAMPTZ,
    CHECK ((status = 'delivered') = (delivered_at IS NOT NULL))
);

CREATE INDEX orders_customer_recent_idx ON orders (customer_id, placed_at DESC);

CREATE TABLE order_items (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id         TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_name     TEXT NOT NULL,
    quantity         INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_kurus BIGINT NOT NULL CHECK (unit_price_kurus >= 0)
);

CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE shipments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id           TEXT NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
    carrier            TEXT NOT NULL,
    tracking_number    TEXT NOT NULL UNIQUE,
    status             TEXT NOT NULL CHECK (status IN ('label_created', 'in_transit', 'out_for_delivery', 'delivered')),
    estimated_delivery DATE NOT NULL
);

CREATE TABLE shipment_events (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shipment_id UUID NOT NULL REFERENCES shipments (id) ON DELETE CASCADE,
    status      TEXT NOT NULL,
    location    TEXT NOT NULL,
    description TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX shipment_events_shipment_idx ON shipment_events (shipment_id, occurred_at);

CREATE TABLE returns (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id   TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    reason     TEXT NOT NULL CHECK (btrim(reason) <> ''),
    status     TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'refunded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The database, not the handler, guarantees one live return per order, so
-- concurrent requests cannot both succeed. A rejected return can be retried.
CREATE UNIQUE INDEX returns_one_live_per_order_idx ON returns (order_id) WHERE status <> 'rejected';

-- +goose Down
DROP TABLE returns;
DROP TABLE shipment_events;
DROP TABLE shipments;
DROP TABLE order_items;
DROP TABLE orders;
DROP TABLE customers;
DROP EXTENSION IF EXISTS vector;
