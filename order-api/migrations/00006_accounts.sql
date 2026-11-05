-- +goose Up
-- Password login. Hashes are bcrypt; a customer without one can only use the demo login.
ALTER TABLE customers ADD COLUMN password_hash TEXT;

CREATE TABLE admins (
    id            TEXT PRIMARY KEY CHECK (id ~ '^ADM-[0-9]{4}$'),
    full_name     TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every time an admin opens a customer's panel. Rows are only ever inserted.
CREATE TABLE admin_audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_id    TEXT NOT NULL REFERENCES admins (id),
    customer_id TEXT NOT NULL REFERENCES customers (id),
    action      TEXT NOT NULL CHECK (action IN ('view_customer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Logins compare emails case-insensitively.
CREATE UNIQUE INDEX customers_email_lower_idx ON customers (lower(email));
CREATE UNIQUE INDEX admins_email_lower_idx ON admins (lower(email));

-- +goose Down
DROP TABLE admin_audit_log;
DROP TABLE admins;
DROP INDEX customers_email_lower_idx;
ALTER TABLE customers DROP COLUMN password_hash;
