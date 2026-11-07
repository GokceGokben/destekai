-- +goose Up
-- The demo names made-up carriers only. A database seeded before seed.sql changed keeps its
-- old names, so they are replaced here with the same choice seed.sql makes per order.
UPDATE shipments
SET carrier = (ARRAY['Martı Kargo', 'Yelken Kargo', 'Kumru Kargo'])[right(order_id, 6)::int % 3 + 1]
WHERE carrier NOT IN ('Martı Kargo', 'Yelken Kargo', 'Kumru Kargo');

-- +goose Down
-- The old names are not kept, so there is nothing to restore.
SELECT 1;
