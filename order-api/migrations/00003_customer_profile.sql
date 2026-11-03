-- +goose Up
ALTER TABLE customers
    ADD COLUMN tier TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('vip', 'standard', 'new')),
    ADD COLUMN loyalty_points INT NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
    ADD COLUMN member_since DATE NOT NULL DEFAULT CURRENT_DATE;

-- +goose Down
ALTER TABLE customers
    DROP COLUMN tier,
    DROP COLUMN loyalty_points,
    DROP COLUMN member_since;
