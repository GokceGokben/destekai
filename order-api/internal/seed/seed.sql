-- Fictional demo data. Dates are relative to now() so that the 14-day return
-- scenarios stay valid; run cmd/seed to refresh them on an existing database.
TRUNCATE returns, shipment_events, shipments, order_items, orders, customers;

INSERT INTO customers (id, full_name, email, phone, city) VALUES
    ('CUS-1001', 'Ayşe Yılmaz',  'ayse.yilmaz@example.com',  '+90 555 000 00 01', 'İstanbul'),
    ('CUS-1002', 'Mehmet Demir', 'mehmet.demir@example.com', '+90 555 000 00 02', 'Ankara'),
    ('CUS-1003', 'Zeynep Kaya',  'zeynep.kaya@example.com',  '+90 555 000 00 03', 'İzmir'),
    ('CUS-1004', 'Emre Çelik',   'emre.celik@example.com',   '+90 555 000 00 04', 'Bursa'),
    ('CUS-1005', 'Elif Şahin',   'elif.sahin@example.com',   '+90 555 000 00 05', 'Antalya'),
    ('CUS-1006', 'Burak Arslan', 'burak.arslan@example.com', '+90 555 000 00 06', 'Adana'),
    ('CUS-1007', 'Selin Koç',    'selin.koc@example.com',    '+90 555 000 00 07', 'Trabzon'),
    ('CUS-1008', 'Can Öztürk',   'can.ozturk@example.com',   '+90 555 000 00 08', 'Eskişehir'),
    ('CUS-1009', 'Deniz Aydın',  'deniz.aydin@example.com',  '+90 555 000 00 09', 'Gaziantep'),
    ('CUS-1010', 'Ece Polat',    'ece.polat@example.com',    '+90 555 000 00 10', 'Konya');

-- Totals start at zero and are derived from order_items below.
INSERT INTO orders (id, customer_id, status, total_kurus, placed_at, delivered_at) VALUES
    ('DA-100001', 'CUS-1001', 'delivered', 0, now() - interval '6 days',  now() - interval '3 days'),   -- returnable
    ('DA-100002', 'CUS-1001', 'shipped',   0, now() - interval '2 days',  NULL),
    ('DA-100003', 'CUS-1001', 'preparing', 0, now() - interval '3 hours', NULL),
    ('DA-100004', 'CUS-1002', 'delivered', 0, now() - interval '23 days', now() - interval '20 days'),  -- window expired
    ('DA-100005', 'CUS-1002', 'delivered', 0, now() - interval '8 days',  now() - interval '5 days'),   -- return requested
    ('DA-100006', 'CUS-1002', 'cancelled', 0, now() - interval '12 days', NULL),
    ('DA-100007', 'CUS-1003', 'delivered', 0, now() - interval '16 days', now() - interval '13 days'),  -- last day of the window
    ('DA-100008', 'CUS-1003', 'shipped',   0, now() - interval '3 days',  NULL),                        -- out for delivery
    ('DA-100009', 'CUS-1003', 'delivered', 0, now() - interval '43 days', now() - interval '40 days'),  -- refunded
    ('DA-100010', 'CUS-1004', 'delivered', 0, now() - interval '4 days',  now() - interval '1 day'),    -- returnable
    ('DA-100011', 'CUS-1004', 'preparing', 0, now() - interval '1 day',   NULL),
    ('DA-100012', 'CUS-1004', 'delivered', 0, now() - interval '11 days', now() - interval '8 days'),   -- return rejected
    ('DA-100013', 'CUS-1005', 'delivered', 0, now() - interval '5 days',  now() - interval '2 days'),   -- returnable
    ('DA-100014', 'CUS-1005', 'shipped',   0, now() - interval '7 days',  NULL),                        -- delayed
    ('DA-100015', 'CUS-1005', 'cancelled', 0, now() - interval '20 days', NULL),
    ('DA-100016', 'CUS-1006', 'delivered', 0, now() - interval '13 days', now() - interval '10 days'),  -- returnable
    ('DA-100017', 'CUS-1006', 'delivered', 0, now() - interval '33 days', now() - interval '30 days'),  -- window expired
    ('DA-100018', 'CUS-1006', 'preparing', 0, now() - interval '5 hours', NULL),
    ('DA-100019', 'CUS-1007', 'shipped',   0, now() - interval '2 days',  NULL),
    ('DA-100020', 'CUS-1007', 'delivered', 0, now() - interval '9 days',  now() - interval '6 days'),   -- return approved
    ('DA-100021', 'CUS-1007', 'delivered', 0, now() - interval '18 days', now() - interval '15 days'),  -- just expired
    ('DA-100022', 'CUS-1008', 'delivered', 0, now() - interval '7 days',  now() - interval '4 days'),   -- returnable
    ('DA-100023', 'CUS-1008', 'preparing', 0, now() - interval '8 hours', NULL),
    ('DA-100024', 'CUS-1009', 'delivered', 0, now() - interval '10 days', now() - interval '7 days'),   -- returnable
    ('DA-100025', 'CUS-1009', 'shipped',   0, now() - interval '3 days',  NULL),
    ('DA-100026', 'CUS-1009', 'cancelled', 0, now() - interval '15 days', NULL),
    ('DA-100027', 'CUS-1010', 'delivered', 0, now() - interval '12 days', now() - interval '9 days'),   -- returnable
    ('DA-100028', 'CUS-1010', 'delivered', 0, now() - interval '63 days', now() - interval '60 days'),  -- window expired
    ('DA-100029', 'CUS-1010', 'shipped',   0, now() - interval '1 day',   NULL),                        -- label only
    ('DA-100030', 'CUS-1010', 'preparing', 0, now() - interval '2 hours', NULL);

INSERT INTO order_items (order_id, product_name, quantity, unit_price_kurus) VALUES
    ('DA-100001', 'Kablosuz Kulaklık',          1, 189900),
    ('DA-100001', 'Telefon Kılıfı',             2,  24900),
    ('DA-100002', 'Akıllı Saat',                1, 349900),
    ('DA-100003', 'Pamuklu Tişört',             3,  29900),
    ('DA-100004', 'Kahve Makinesi',             1, 459900),
    ('DA-100005', 'Spor Ayakkabı',              1, 249900),
    ('DA-100006', 'Masa Lambası',               1,  79900),
    ('DA-100007', 'Kot Pantolon',               1,  99900),
    ('DA-100007', 'Deri Kemer',                 1,  39900),
    ('DA-100008', 'Blender Seti',               1, 169900),
    ('DA-100009', 'Elektrikli Süpürge',         1, 899900),
    ('DA-100010', 'Bluetooth Hoparlör',         1, 129900),
    ('DA-100011', 'Sırt Çantası',               1,  89900),
    ('DA-100012', 'Yağmurluk',                  1, 119900),
    ('DA-100013', 'Çocuk Bisikleti',            1, 599900),
    ('DA-100014', 'Ofis Koltuğu',               1, 749900),
    ('DA-100015', 'Nevresim Takımı',            1,  64900),
    ('DA-100016', 'Tost Makinesi',              1, 109900),
    ('DA-100017', 'Mutfak Robotu',              1, 399900),
    ('DA-100018', 'Yoga Matı',                  2,  34900),
    ('DA-100019', 'Dizüstü Bilgisayar Çantası', 1,  69900),
    ('DA-100020', 'Kışlık Mont',                1, 279900),
    ('DA-100021', 'Ütü',                        1, 149900),
    ('DA-100022', 'Oyun Faresi',                1,  84900),
    ('DA-100022', 'Mekanik Klavye',             1, 219900),
    ('DA-100023', 'Termos',                     1,  44900),
    ('DA-100024', 'Saç Kurutma Makinesi',       1,  94900),
    ('DA-100025', 'Tablet Kalemi',              1,  74900),
    ('DA-100026', 'Duvar Saati',                1,  39900),
    ('DA-100027', 'Çaycı Seti',                 1, 124900),
    ('DA-100028', 'Halı',                       1, 359900),
    ('DA-100029', 'Kitap Seti',                 4,  17900),
    ('DA-100030', 'Baharat Rafı',               1,  54900);

UPDATE orders o
SET total_kurus = t.total
FROM (
    SELECT order_id, sum(quantity * unit_price_kurus) AS total
    FROM order_items
    GROUP BY order_id
) t
WHERE t.order_id = o.id;

-- Every shipped or delivered order has a shipment.
INSERT INTO shipments (order_id, carrier, tracking_number, status, estimated_delivery)
SELECT
    o.id,
    (ARRAY['Martı Kargo', 'Yelken Kargo', 'Kumru Kargo'])[right(o.id, 6)::int % 3 + 1],
    'TRK' || right(o.id, 6),
    CASE
        WHEN o.status = 'delivered' THEN 'delivered'
        WHEN o.id = 'DA-100008' THEN 'out_for_delivery'
        WHEN o.id = 'DA-100029' THEN 'label_created'
        ELSE 'in_transit'
    END,
    CASE
        WHEN o.status = 'delivered' THEN o.delivered_at::date
        WHEN o.id = 'DA-100014' THEN current_date - 2
        ELSE current_date + 2
    END
FROM orders o
WHERE o.status IN ('shipped', 'delivered');

INSERT INTO shipment_events (shipment_id, status, location, description, occurred_at)
SELECT s.id, 'label_created', 'İstanbul Çıkış Şubesi', 'Gönderi bilgisi oluşturuldu', o.placed_at + interval '6 hours'
FROM shipments s JOIN orders o ON o.id = s.order_id;

INSERT INTO shipment_events (shipment_id, status, location, description, occurred_at)
SELECT s.id, 'in_transit', 'İstanbul Transfer Merkezi', 'Gönderi transfer merkezine ulaştı', o.placed_at + interval '1 day'
FROM shipments s JOIN orders o ON o.id = s.order_id
WHERE s.status <> 'label_created';

INSERT INTO shipment_events (shipment_id, status, location, description, occurred_at)
SELECT s.id, 'out_for_delivery', c.city || ' Dağıtım Şubesi', 'Gönderi dağıtıma çıkarıldı',
       COALESCE(o.delivered_at - interval '4 hours', now() - interval '2 hours')
FROM shipments s
JOIN orders o ON o.id = s.order_id
JOIN customers c ON c.id = o.customer_id
WHERE s.status IN ('out_for_delivery', 'delivered');

INSERT INTO shipment_events (shipment_id, status, location, description, occurred_at)
SELECT s.id, 'delivered', c.city, 'Gönderi alıcıya teslim edildi', o.delivered_at
FROM shipments s
JOIN orders o ON o.id = s.order_id
JOIN customers c ON c.id = o.customer_id
WHERE s.status = 'delivered';

INSERT INTO returns (order_id, reason, status, created_at) VALUES
    ('DA-100005', 'Ayakkabının numarası küçük geldi.',   'requested', now() - interval '1 day'),
    ('DA-100009', 'Ürün çalışmıyor, hiç açılmadı.',      'refunded',  now() - interval '35 days'),
    ('DA-100012', 'Ürünü beğenmedim.',                   'rejected',  now() - interval '5 days'),
    ('DA-100020', 'Montun fermuarı kusurlu geldi.',      'approved',  now() - interval '3 days');
