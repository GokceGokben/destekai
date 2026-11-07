// Package store holds all SQL. Every customer-facing query takes customerID and
// filters on it, so ownership cannot be forgotten in a handler.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/destekai/order-api/migrations"
)

const (
	recentOrdersLimit = 10
	returnWindow      = 14 * 24 * time.Hour

	pgUniqueViolation = "23505"
)

var (
	// ErrNotFound means the order does not exist or belongs to someone else.
	// The two cases are deliberately indistinguishable.
	ErrNotFound            = errors.New("order not found")
	ErrNoShipment          = errors.New("order has no shipment yet")
	ErrNotDelivered        = errors.New("order is not delivered")
	ErrReturnWindowExpired = errors.New("return window expired")
	ErrReturnExists        = errors.New("order already has a return")
	ErrCustomerNotFound    = errors.New("customer not found")
	// ErrNoAccount covers an unknown email and an account without a password alike.
	ErrNoAccount = errors.New("no account")
)

type OrderItem struct {
	ProductName    string  `json:"product_name"`
	Quantity       int     `json:"quantity"`
	UnitPriceKurus int64   `json:"unit_price_kurus"`
	ImageKey       *string `json:"image_key"`
}

type Order struct {
	ID             string     `json:"id"`
	Status         string     `json:"status"`
	TotalKurus     int64      `json:"total_kurus"`
	PlacedAt       time.Time  `json:"placed_at"`
	DeliveredAt    *time.Time `json:"delivered_at"`
	ReturnID       *string    `json:"return_id"`
	ReturnStatus   *string    `json:"return_status"`
	Carrier        *string    `json:"carrier"`
	TrackingNumber *string    `json:"tracking_number"`
	// The shipment's estimate once shipped; before that, the latest date the shipping
	// policy promises. Null for a cancelled order.
	EstimatedDelivery *string     `json:"estimated_delivery"`
	Items             []OrderItem `json:"items"`
}

type ShipmentEvent struct {
	Status      string    `json:"status"`
	Location    string    `json:"location"`
	Description string    `json:"description"`
	OccurredAt  time.Time `json:"occurred_at"`
}

type Shipment struct {
	OrderID           string          `json:"order_id"`
	Carrier           string          `json:"carrier"`
	TrackingNumber    string          `json:"tracking_number"`
	Status            string          `json:"status"`
	EstimatedDelivery string          `json:"estimated_delivery"`
	Events            []ShipmentEvent `json:"events"`
}

type Return struct {
	ID        string    `json:"id"`
	OrderID   string    `json:"order_id"`
	Reason    string    `json:"reason"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

// Admin is a store employee who can view customers' panels read-only.
type Admin struct {
	ID       string `json:"id"`
	FullName string `json:"full_name"`
	Email    string `json:"email"`
}

// Handoff is a conversation passed to a human agent.
type Handoff struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id"`
	Reason         string    `json:"reason"`
	Summary        string    `json:"summary"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"created_at"`
}

// Customer is the demo login's view of a customer. It leaves out the phone number.
type Customer struct {
	ID            string `json:"id"`
	FullName      string `json:"full_name"`
	Email         string `json:"email"`
	City          string `json:"city"`
	Tier          string `json:"tier"`
	LoyaltyPoints int    `json:"loyalty_points"`
	MemberYears   int    `json:"member_years"`
	OrderCount    int    `json:"order_count"`
}

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// Migrate applies the embedded schema migrations.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()

	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		return fmt.Errorf("create migration provider: %w", err)
	}
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}
	return nil
}

// SetAgentPassword sets the login password of the agent service's database role.
// ALTER ROLE takes no bind parameters, so format() does the quoting.
func SetAgentPassword(ctx context.Context, pool *pgxpool.Pool, password string) error {
	var statement string
	err := pool.QueryRow(ctx, `SELECT format('ALTER ROLE destekai_agent PASSWORD %L', $1::text)`,
		password).Scan(&statement)
	if err != nil {
		return fmt.Errorf("build agent role statement: %w", err)
	}
	if _, err := pool.Exec(ctx, statement); err != nil {
		return fmt.Errorf("set agent role password: %w", err)
	}
	return nil
}

// Ping reports whether the database is reachable.
func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

// ListCustomers returns every customer. Only the demo login may call it.
const customerQuery = `
	SELECT c.id, c.full_name, c.email, c.city, c.tier, c.loyalty_points,
		extract(year FROM age(c.member_since))::int, count(o.id)::int
	FROM customers c
	LEFT JOIN orders o ON o.customer_id = c.id`

func scanCustomer(row pgx.CollectableRow) (Customer, error) {
	var c Customer
	err := row.Scan(&c.ID, &c.FullName, &c.Email, &c.City, &c.Tier, &c.LoyaltyPoints,
		&c.MemberYears, &c.OrderCount)
	return c, err
}

func (s *Store) ListCustomers(ctx context.Context) ([]Customer, error) {
	rows, err := s.pool.Query(ctx, customerQuery+` GROUP BY c.id ORDER BY c.id`)
	if err != nil {
		return nil, fmt.Errorf("query customers: %w", err)
	}
	customers, err := pgx.CollectRows(rows, scanCustomer)
	if err != nil {
		return nil, fmt.Errorf("scan customers: %w", err)
	}
	return customers, nil
}

func (s *Store) GetCustomer(ctx context.Context, customerID string) (Customer, error) {
	rows, err := s.pool.Query(ctx, customerQuery+` WHERE c.id = $1 GROUP BY c.id`, customerID)
	if err != nil {
		return Customer{}, fmt.Errorf("query customer: %w", err)
	}
	customer, err := pgx.CollectExactlyOneRow(rows, scanCustomer)
	if errors.Is(err, pgx.ErrNoRows) {
		return Customer{}, ErrCustomerNotFound
	}
	if err != nil {
		return Customer{}, fmt.Errorf("scan customer: %w", err)
	}
	return customer, nil
}

// CustomerCredentials returns the ID and password hash for a login email. A customer
// without a password, who can only use the demo login, counts as no account.
func (s *Store) CustomerCredentials(ctx context.Context, email string) (id, hash string, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT id, password_hash FROM customers
		WHERE lower(email) = lower($1) AND password_hash IS NOT NULL`, email).Scan(&id, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNoAccount
	}
	if err != nil {
		return "", "", fmt.Errorf("query customer credentials: %w", err)
	}
	return id, hash, nil
}

func (s *Store) AdminCredentials(ctx context.Context, email string) (Admin, string, error) {
	var a Admin
	var hash string
	err := s.pool.QueryRow(ctx, `
		SELECT id, full_name, email, password_hash FROM admins WHERE lower(email) = lower($1)`,
		email).Scan(&a.ID, &a.FullName, &a.Email, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Admin{}, "", ErrNoAccount
	}
	if err != nil {
		return Admin{}, "", fmt.Errorf("query admin credentials: %w", err)
	}
	return a, hash, nil
}

func (s *Store) GetAdmin(ctx context.Context, adminID string) (Admin, error) {
	var a Admin
	err := s.pool.QueryRow(ctx, `SELECT id, full_name, email FROM admins WHERE id = $1`, adminID).
		Scan(&a.ID, &a.FullName, &a.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return Admin{}, ErrNoAccount
	}
	if err != nil {
		return Admin{}, fmt.Errorf("query admin: %w", err)
	}
	return a, nil
}

// RecordAdminView writes the audit row for an admin opening a customer's panel.
func (s *Store) RecordAdminView(ctx context.Context, adminID, customerID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO admin_audit_log (admin_id, customer_id, action) VALUES ($1, $2, 'view_customer')`,
		adminID, customerID)
	if err != nil {
		return fmt.Errorf("insert audit row: %w", err)
	}
	return nil
}

// The join yields at most one return per order: rejected ones are excluded and
// the partial unique index allows a single live one.
const orderQuery = `
	SELECT o.id, o.status, o.total_kurus, o.placed_at, o.delivered_at, r.id::text, r.status,
		s.carrier, s.tracking_number, s.estimated_delivery::text
	FROM orders o
	LEFT JOIN returns r ON r.order_id = o.id AND r.status <> 'rejected'
	LEFT JOIN shipments s ON s.order_id = o.id`

func scanOrder(row pgx.CollectableRow) (Order, error) {
	var o Order
	err := row.Scan(&o.ID, &o.Status, &o.TotalKurus, &o.PlacedAt, &o.DeliveredAt, &o.ReturnID,
		&o.ReturnStatus, &o.Carrier, &o.TrackingNumber, &o.EstimatedDelivery)
	if err == nil && o.EstimatedDelivery == nil && o.Status == "preparing" {
		estimate := preparingEstimate(o.PlacedAt)
		o.EstimatedDelivery = &estimate
	}
	return o, err
}

// istanbul is Turkey's time, fixed at UTC+3 since 2016; the dates customers see are local.
var istanbul = time.FixedZone("TRT", 3*60*60)

// preparingBusinessDays is the shipping policy's latest promise (docs/policies/kargo.md):
// up to 2 business days to hand the order to the carrier, then up to 3 to deliver it.
const preparingBusinessDays = 5

// preparingEstimate is the latest delivery date the policy promises for an order not yet
// shipped. Weekends are skipped; public holidays are not known to the demo.
func preparingEstimate(placedAt time.Time) string {
	day := placedAt.In(istanbul)
	for added := 0; added < preparingBusinessDays; {
		day = day.AddDate(0, 0, 1)
		if day.Weekday() != time.Saturday && day.Weekday() != time.Sunday {
			added++
		}
	}
	return day.Format(time.DateOnly)
}

// ListOrders returns the customer's most recent orders, newest first.
func (s *Store) ListOrders(ctx context.Context, customerID string) ([]Order, error) {
	rows, err := s.pool.Query(ctx,
		orderQuery+` WHERE o.customer_id = $1 ORDER BY o.placed_at DESC LIMIT $2`,
		customerID, recentOrdersLimit)
	if err != nil {
		return nil, fmt.Errorf("query orders: %w", err)
	}
	orders, err := pgx.CollectRows(rows, scanOrder)
	if err != nil {
		return nil, fmt.Errorf("scan orders: %w", err)
	}
	if err := s.attachItems(ctx, orders); err != nil {
		return nil, err
	}
	return orders, nil
}

// GetOrder returns one of the customer's orders.
func (s *Store) GetOrder(ctx context.Context, customerID, orderID string) (Order, error) {
	rows, err := s.pool.Query(ctx,
		orderQuery+` WHERE o.id = $1 AND o.customer_id = $2`,
		orderID, customerID)
	if err != nil {
		return Order{}, fmt.Errorf("query order: %w", err)
	}
	order, err := pgx.CollectExactlyOneRow(rows, scanOrder)
	if errors.Is(err, pgx.ErrNoRows) {
		return Order{}, ErrNotFound
	}
	if err != nil {
		return Order{}, fmt.Errorf("scan order: %w", err)
	}

	orders := []Order{order}
	if err := s.attachItems(ctx, orders); err != nil {
		return Order{}, err
	}
	return orders[0], nil
}

// attachItems fetches the items of all orders in one query to avoid N+1 lookups.
func (s *Store) attachItems(ctx context.Context, orders []Order) error {
	ids := make([]string, len(orders))
	indexByID := make(map[string]int, len(orders))
	for i := range orders {
		ids[i] = orders[i].ID
		indexByID[orders[i].ID] = i
		orders[i].Items = []OrderItem{}
	}

	rows, err := s.pool.Query(ctx, `
		SELECT order_id, product_name, quantity, unit_price_kurus, image_key
		FROM order_items
		WHERE order_id = ANY($1)
		ORDER BY id`, ids)
	if err != nil {
		return fmt.Errorf("query order items: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var orderID string
		var item OrderItem
		if err := rows.Scan(&orderID, &item.ProductName, &item.Quantity, &item.UnitPriceKurus, &item.ImageKey); err != nil {
			return fmt.Errorf("scan order item: %w", err)
		}
		i := indexByID[orderID]
		orders[i].Items = append(orders[i].Items, item)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read order items: %w", err)
	}
	return nil
}

// GetShipment returns the shipment of one of the customer's orders with its
// events in chronological order.
func (s *Store) GetShipment(ctx context.Context, customerID, orderID string) (Shipment, error) {
	var shipment Shipment
	var shipmentID string
	err := s.pool.QueryRow(ctx, `
		SELECT s.id, s.order_id, s.carrier, s.tracking_number, s.status, s.estimated_delivery::text
		FROM shipments s
		JOIN orders o ON o.id = s.order_id
		WHERE s.order_id = $1 AND o.customer_id = $2`, orderID, customerID,
	).Scan(&shipmentID, &shipment.OrderID, &shipment.Carrier, &shipment.TrackingNumber,
		&shipment.Status, &shipment.EstimatedDelivery)
	if errors.Is(err, pgx.ErrNoRows) {
		return Shipment{}, s.missingShipmentError(ctx, customerID, orderID)
	}
	if err != nil {
		return Shipment{}, fmt.Errorf("query shipment: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT status, location, description, occurred_at
		FROM shipment_events
		WHERE shipment_id = $1
		ORDER BY occurred_at`, shipmentID)
	if err != nil {
		return Shipment{}, fmt.Errorf("query shipment events: %w", err)
	}
	shipment.Events, err = pgx.CollectRows(rows, pgx.RowToStructByPos[ShipmentEvent])
	if err != nil {
		return Shipment{}, fmt.Errorf("scan shipment events: %w", err)
	}
	return shipment, nil
}

// missingShipmentError separates "your order has not shipped" from "no such
// order". The lookup is scoped to the customer, so it reveals nothing about
// other customers' orders.
func (s *Store) missingShipmentError(ctx context.Context, customerID, orderID string) error {
	var owned bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM orders WHERE id = $1 AND customer_id = $2)`,
		orderID, customerID).Scan(&owned)
	if err != nil {
		return fmt.Errorf("check order ownership: %w", err)
	}
	if owned {
		return ErrNoShipment
	}
	return ErrNotFound
}

// CreateReturn opens a return for one of the customer's delivered orders.
func (s *Store) CreateReturn(ctx context.Context, customerID, orderID, reason string, now time.Time) (Return, error) {
	var status string
	var deliveredAt sql.NullTime
	err := s.pool.QueryRow(ctx,
		`SELECT status, delivered_at FROM orders WHERE id = $1 AND customer_id = $2`,
		orderID, customerID).Scan(&status, &deliveredAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Return{}, ErrNotFound
	}
	if err != nil {
		return Return{}, fmt.Errorf("query order: %w", err)
	}
	if err := checkReturnable(status, deliveredAt.Time, now); err != nil {
		return Return{}, err
	}

	// No check-then-insert for duplicates: that would race. The unique index
	// decides, and the violation is translated into a domain error.
	var ret Return
	err = s.pool.QueryRow(ctx, `
		INSERT INTO returns (order_id, reason)
		VALUES ($1, $2)
		RETURNING id::text, order_id, reason, status, created_at`, orderID, reason,
	).Scan(&ret.ID, &ret.OrderID, &ret.Reason, &ret.Status, &ret.CreatedAt)

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
		return Return{}, ErrReturnExists
	}
	if err != nil {
		return Return{}, fmt.Errorf("insert return: %w", err)
	}
	return ret, nil
}

func checkReturnable(status string, deliveredAt, now time.Time) error {
	if status != "delivered" {
		return ErrNotDelivered
	}
	if now.After(deliveredAt.Add(returnWindow)) {
		return ErrReturnWindowExpired
	}
	return nil
}

// CreateHandoff records a handoff for one of the customer's conversations. Asking again for
// the same conversation returns the first record unchanged, so a retry cannot overwrite the
// summary or open a second ticket.
func (s *Store) CreateHandoff(ctx context.Context, customerID, conversationID, reason, summary string) (Handoff, error) {
	var h Handoff
	err := s.pool.QueryRow(ctx, `
		INSERT INTO handoffs (customer_id, conversation_id, reason, summary)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (customer_id, conversation_id) DO UPDATE SET customer_id = EXCLUDED.customer_id
		RETURNING id::text, conversation_id, reason, summary, status, created_at`,
		customerID, conversationID, reason, summary,
	).Scan(&h.ID, &h.ConversationID, &h.Reason, &h.Summary, &h.Status, &h.CreatedAt)
	if err != nil {
		return Handoff{}, fmt.Errorf("insert handoff: %w", err)
	}
	return h, nil
}

// PurgeOldRecords deletes agent traces and admin audit rows older than their
// retention, in days, so personal data is not kept longer than it is needed.
func (s *Store) PurgeOldRecords(ctx context.Context, traceDays, auditDays int) (traces, audits int64, err error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM agent_traces WHERE started_at < now() - make_interval(days => $1)`, traceDays)
	if err != nil {
		return 0, 0, fmt.Errorf("purge traces: %w", err)
	}
	traces = tag.RowsAffected()
	tag, err = s.pool.Exec(ctx,
		`DELETE FROM admin_audit_log WHERE created_at < now() - make_interval(days => $1)`, auditDays)
	if err != nil {
		return traces, 0, fmt.Errorf("purge audit log: %w", err)
	}
	return traces, tag.RowsAffected(), nil
}
