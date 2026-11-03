-- +goose Up
-- A stable key per product. The frontend maps it to a photo, so the database holds no
-- third-party URLs.
ALTER TABLE order_items ADD COLUMN image_key TEXT CHECK (image_key ~ '^[a-z0-9-]+$');

-- +goose Down
ALTER TABLE order_items DROP COLUMN image_key;
