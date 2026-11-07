package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/destekai/order-api/internal/auth"
	"github.com/destekai/order-api/internal/seed"
	"github.com/destekai/order-api/internal/store"
)

// A fresh key pair per test run; nothing secret is checked in.
var testKeys = mustKeys()

func mustKeys() auth.Keys {
	keys, err := auth.GenerateKeys()
	if err != nil {
		panic(err)
	}
	return keys
}

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		fmt.Println("TEST_DATABASE_URL is not set; integration tests are skipped")
		os.Exit(m.Run())
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		fmt.Println("connect:", err)
		os.Exit(1)
	}
	if err := store.Migrate(ctx, pool); err != nil {
		fmt.Println("migrate:", err)
		os.Exit(1)
	}
	testPool = pool
	code := m.Run()
	pool.Close()
	os.Exit(code)
}

// newServer resets the data so that tests stay independent of each other.
func newServer(t *testing.T) http.Handler {
	t.Helper()
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	if err := seed.Apply(context.Background(), testPool); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return NewRouter(store.New(testPool), testKeys, false)
}

func newDevServer(t *testing.T) http.Handler {
	t.Helper()
	newServer(t)
	return NewRouter(store.New(testPool), testKeys, true)
}

func request(t *testing.T, h http.Handler, method, path, customer, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if customer != "" {
		token, err := auth.Issue(testKeys.Private, customer, time.Hour)
		if err != nil {
			t.Fatalf("issue token: %v", err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return v
}

func assertError(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d; body = %s", rec.Code, status, rec.Body.String())
	}
	if got := decode[map[string]string](t, rec)["code"]; got != code {
		t.Errorf("code = %q, want %q", got, code)
	}
}

func countReturns(t *testing.T, orderID string) int {
	t.Helper()
	var n int
	err := testPool.QueryRow(context.Background(),
		`SELECT count(*) FROM returns WHERE order_id = $1`, orderID).Scan(&n)
	if err != nil {
		t.Fatalf("count returns: %v", err)
	}
	return n
}

func TestDevLoginIsOffByDefault(t *testing.T) {
	h := newServer(t)

	rec := request(t, h, http.MethodGet, "/v1/dev/customers", "", "")
	assertError(t, rec, http.StatusNotFound, "not_found")
	rec = request(t, h, http.MethodPost, "/v1/dev/token", "", `{"customer_id":"CUS-1001"}`)
	assertError(t, rec, http.StatusNotFound, "not_found")
}

func TestDevCustomersHidePhoneNumbers(t *testing.T) {
	h := newDevServer(t)

	rec := request(t, h, http.MethodGet, "/v1/dev/customers", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", rec.Code, rec.Body.String())
	}
	body := decode[struct {
		Customers []store.Customer `json:"customers"`
	}](t, rec)
	if len(body.Customers) != 10 {
		t.Fatalf("customers = %d, want 10", len(body.Customers))
	}
	first := body.Customers[0]
	if first.ID != "CUS-1001" || first.OrderCount != 3 || first.Tier != "vip" ||
		first.LoyaltyPoints != 1840 || first.MemberYears != 2 {
		t.Errorf("first customer = %+v", first)
	}
	if text := rec.Body.String(); strings.Contains(text, "+90") {
		t.Errorf("response leaks phone numbers: %s", text)
	}
}

func TestDevTokenWorksOnlyForItsCustomer(t *testing.T) {
	h := newDevServer(t)

	rec := request(t, h, http.MethodPost, "/v1/dev/token", "", `{"customer_id":"CUS-1002"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", rec.Code, rec.Body.String())
	}
	body := decode[struct {
		Token    string         `json:"token"`
		Customer store.Customer `json:"customer"`
	}](t, rec)
	if body.Customer.FullName != "Mehmet Demir" {
		t.Errorf("customer = %+v", body.Customer)
	}

	authorized := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+body.Token)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := authorized("/v1/orders/DA-100004"); rec.Code != http.StatusOK {
		t.Errorf("own order status = %d", rec.Code)
	}
	assertError(t, authorized("/v1/orders/DA-100001"), http.StatusNotFound, "order_not_found")
}

func TestDevTokenRejectsBadRequests(t *testing.T) {
	h := newDevServer(t)

	rec := request(t, h, http.MethodPost, "/v1/dev/token", "", `{"customer_id":"CUS-9999"}`)
	assertError(t, rec, http.StatusNotFound, "customer_not_found")
	rec = request(t, h, http.MethodPost, "/v1/dev/token", "", `{"customer_id":"CUS-1001","role":"admin"}`)
	assertError(t, rec, http.StatusBadRequest, "invalid_body")
}

func TestHealth(t *testing.T) {
	h := newServer(t)
	if rec := request(t, h, http.MethodGet, "/health", "", ""); rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestListOrdersReturnsOnlyOwnOrdersNewestFirst(t *testing.T) {
	h := newServer(t)
	rec := request(t, h, http.MethodGet, "/v1/orders", "CUS-1001", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", rec.Code, rec.Body.String())
	}

	orders := decode[struct{ Orders []store.Order }](t, rec).Orders
	want := []string{"DA-100003", "DA-100002", "DA-100001"}
	if len(orders) != len(want) {
		t.Fatalf("got %d orders, want %d", len(orders), len(want))
	}
	for i, id := range want {
		if orders[i].ID != id {
			t.Errorf("orders[%d] = %s, want %s", i, orders[i].ID, id)
		}
		for _, item := range orders[i].Items {
			if item.ImageKey == nil {
				t.Errorf("%s in %s has no image key", item.ProductName, orders[i].ID)
			}
		}
		if len(orders[i].Items) == 0 {
			t.Errorf("order %s has no items", orders[i].ID)
		}
	}
}

func TestGetOrder(t *testing.T) {
	h := newServer(t)
	rec := request(t, h, http.MethodGet, "/v1/orders/DA-100001", "CUS-1001", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", rec.Code, rec.Body.String())
	}

	order := decode[store.Order](t, rec)
	if order.Status != "delivered" || len(order.Items) != 2 {
		t.Errorf("unexpected order: %+v", order)
	}
	if order.TotalKurus != 239700 {
		t.Errorf("total = %d, want the item sum 239700", order.TotalKurus)
	}
}

func TestOrdersCarryAnEstimatedDeliveryUntilCancelled(t *testing.T) {
	h := newServer(t)
	estimate := func(customerID, orderID string) *string {
		return decode[store.Order](t, request(t, h, http.MethodGet, "/v1/orders/"+orderID, customerID, "")).EstimatedDelivery
	}

	// Preparing: the policy's latest date. Shipped: the shipment's own estimate.
	if e := estimate("CUS-1001", "DA-100003"); e == nil {
		t.Error("a preparing order has no estimated delivery")
	}
	if e := estimate("CUS-1001", "DA-100002"); e == nil {
		t.Error("a shipped order has no estimated delivery")
	}
	if e := estimate("CUS-1002", "DA-100006"); e != nil {
		t.Errorf("a cancelled order has an estimated delivery: %s", *e)
	}
}

func TestGetOrderShowsLiveReturnButNotRejectedOne(t *testing.T) {
	h := newServer(t)

	live := decode[store.Order](t, request(t, h, http.MethodGet, "/v1/orders/DA-100005", "CUS-1002", ""))
	if live.ReturnStatus == nil || *live.ReturnStatus != "requested" {
		t.Errorf("return status = %v, want requested", live.ReturnStatus)
	}
	rejected := decode[store.Order](t, request(t, h, http.MethodGet, "/v1/orders/DA-100012", "CUS-1004", ""))
	if rejected.ReturnStatus != nil {
		t.Errorf("return status = %q, want none", *rejected.ReturnStatus)
	}
}

func TestGetShipment(t *testing.T) {
	h := newServer(t)
	rec := request(t, h, http.MethodGet, "/v1/orders/DA-100001/shipment", "CUS-1001", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", rec.Code, rec.Body.String())
	}

	shipment := decode[store.Shipment](t, rec)
	if shipment.Status != "delivered" || len(shipment.Events) != 4 {
		t.Fatalf("unexpected shipment: %+v", shipment)
	}
	for i := 1; i < len(shipment.Events); i++ {
		if shipment.Events[i].OccurredAt.Before(shipment.Events[i-1].OccurredAt) {
			t.Errorf("events are not chronological: %+v", shipment.Events)
		}
	}
}

func TestGetShipmentBeforeDispatch(t *testing.T) {
	h := newServer(t)
	rec := request(t, h, http.MethodGet, "/v1/orders/DA-100003/shipment", "CUS-1001", "")
	assertError(t, rec, http.StatusNotFound, "shipment_not_found")
}

// A customer probing another customer's order must get the same answer as for
// an order that does not exist, on every route.
func TestOtherCustomersOrdersLookNonexistent(t *testing.T) {
	h := newServer(t)
	body := `{"reason":"başkasının siparişi"}`
	routes := []struct{ method, suffix, body string }{
		{http.MethodGet, "", ""},
		{http.MethodGet, "/shipment", ""},
		{http.MethodPost, "/returns", body},
	}

	for _, route := range routes {
		foreign := request(t, h, route.method, "/v1/orders/DA-100004"+route.suffix, "CUS-1001", route.body)
		missing := request(t, h, route.method, "/v1/orders/DA-999999"+route.suffix, "CUS-1001", route.body)
		assertError(t, foreign, http.StatusNotFound, "order_not_found")
		if foreign.Body.String() != missing.Body.String() {
			t.Errorf("%s: foreign %q differs from missing %q", route.suffix, foreign.Body.String(), missing.Body.String())
		}
	}

	// DA-100001 is returnable, so only the ownership check can stop this one.
	rec := request(t, h, http.MethodPost, "/v1/orders/DA-100001/returns", "CUS-1002", body)
	assertError(t, rec, http.StatusNotFound, "order_not_found")
	if n := countReturns(t, "DA-100001"); n != 0 {
		t.Errorf("foreign request created %d returns", n)
	}
}

func TestCustomerIDInBodyIsRejected(t *testing.T) {
	h := newServer(t)
	rec := request(t, h, http.MethodPost, "/v1/orders/DA-100001/returns", "CUS-1002",
		`{"reason":"test","customer_id":"CUS-1001"}`)
	assertError(t, rec, http.StatusBadRequest, "invalid_body")
}

func TestV1RequiresValidToken(t *testing.T) {
	h := newServer(t)
	// Signed by a key the service does not know.
	anotherKey, err := auth.Issue(mustKeys().Private, "CUS-1001", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	expired, err := auth.Issue(testKeys.Private, "CUS-1001", -time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	headers := map[string]string{
		"missing":      "",
		"wrong scheme": "Basic abc",
		"garbage":      "Bearer abc",
		"another key":  "Bearer " + anotherKey,
		"expired":      "Bearer " + expired,
	}
	for name, header := range headers {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/v1/orders", nil)
			if header != "" {
				req.Header.Set("Authorization", header)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			assertError(t, rec, http.StatusUnauthorized, "unauthorized")
		})
	}
}

func TestMalformedOrderIDIsNotFound(t *testing.T) {
	h := newServer(t)
	for _, id := range []string{"abc", "DA-1", "DA-100001x", "%00", "DA-100001%00", "'%20OR%201=1"} {
		rec := request(t, h, http.MethodGet, "/v1/orders/"+id, "CUS-1001", "")
		if rec.Code != http.StatusNotFound {
			t.Errorf("id %q: status = %d, want 404", id, rec.Code)
		}
	}
}

func TestCreateReturn(t *testing.T) {
	h := newServer(t)
	rec := request(t, h, http.MethodPost, "/v1/orders/DA-100001/returns", "CUS-1001",
		`{"reason":"  Ürün beklediğim gibi çıkmadı.  "}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d; body = %s", rec.Code, rec.Body.String())
	}

	ret := decode[store.Return](t, rec)
	if ret.OrderID != "DA-100001" || ret.Status != "requested" || ret.Reason != "Ürün beklediğim gibi çıkmadı." {
		t.Errorf("unexpected return: %+v", ret)
	}
	if n := countReturns(t, "DA-100001"); n != 1 {
		t.Errorf("database has %d returns, want 1", n)
	}
}

func TestCreateReturnRules(t *testing.T) {
	h := newServer(t)
	body := `{"reason":"Fikrimi değiştirdim."}`
	tests := []struct {
		name, order, customer string
		status                int
		code                  string
	}{
		{"last day of the window", "DA-100007", "CUS-1003", http.StatusCreated, ""},
		{"rejected return can be retried", "DA-100012", "CUS-1004", http.StatusCreated, ""},
		{"one day past the window", "DA-100021", "CUS-1007", http.StatusConflict, "return_window_expired"},
		{"preparing", "DA-100003", "CUS-1001", http.StatusConflict, "order_not_delivered"},
		{"in transit", "DA-100002", "CUS-1001", http.StatusConflict, "order_not_delivered"},
		{"cancelled", "DA-100006", "CUS-1002", http.StatusConflict, "order_not_delivered"},
		{"open return", "DA-100005", "CUS-1002", http.StatusConflict, "return_already_exists"},
		{"approved return", "DA-100020", "CUS-1007", http.StatusConflict, "return_already_exists"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := request(t, h, http.MethodPost, "/v1/orders/"+tt.order+"/returns", tt.customer, body)
			if tt.code == "" {
				if rec.Code != tt.status {
					t.Fatalf("status = %d; body = %s", rec.Code, rec.Body.String())
				}
				return
			}
			assertError(t, rec, tt.status, tt.code)
		})
	}
}

func TestCreateReturnValidatesBody(t *testing.T) {
	h := newServer(t)
	tests := map[string]struct {
		body, code string
	}{
		"not json":     {`nope`, "invalid_body"},
		"empty reason": {`{"reason":"   "}`, "invalid_reason"},
		"no reason":    {`{}`, "invalid_reason"},
		"long reason":  {fmt.Sprintf(`{"reason":%q}`, strings.Repeat("ş", maxReasonLength+1)), "invalid_reason"},
		"huge body":    {fmt.Sprintf(`{"reason":%q}`, strings.Repeat("a", maxBodyBytes)), "invalid_body"},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			rec := request(t, h, http.MethodPost, "/v1/orders/DA-100001/returns", "CUS-1001", tt.body)
			assertError(t, rec, http.StatusBadRequest, tt.code)
		})
	}
}

// The eligibility check does not look at existing returns, so every request
// reaches the INSERT and only the unique index can keep this at one row.
func TestConcurrentReturnsCreateOneRow(t *testing.T) {
	h := newServer(t)
	const attempts = 20

	codes := make([]int, attempts)
	var wg sync.WaitGroup
	for i := range attempts {
		wg.Go(func() {
			token, err := auth.Issue(testKeys.Private, "CUS-1001", time.Hour)
			if err != nil {
				t.Error(err)
				return
			}
			req := httptest.NewRequest(http.MethodPost, "/v1/orders/DA-100001/returns",
				strings.NewReader(`{"reason":"Aynı anda gönderildi."}`))
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			codes[i] = rec.Code
		})
	}
	wg.Wait()

	created, conflicts := 0, 0
	for _, code := range codes {
		switch code {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			conflicts++
		default:
			t.Errorf("unexpected status %d", code)
		}
	}
	if created != 1 || conflicts != attempts-1 {
		t.Errorf("created = %d, conflicts = %d", created, conflicts)
	}
	if n := countReturns(t, "DA-100001"); n != 1 {
		t.Errorf("database has %d returns, want 1", n)
	}
}

func TestSeedData(t *testing.T) {
	newServer(t)
	counts := map[string]int{"customers": 10, "orders": 30}
	for table, want := range counts {
		var got int
		if err := testPool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("%s = %d, want %d", table, got, want)
		}
	}

	var mismatched int
	err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM orders o
		WHERE o.total_kurus <> (
			SELECT sum(quantity * unit_price_kurus) FROM order_items WHERE order_id = o.id
		)`).Scan(&mismatched)
	if err != nil {
		t.Fatal(err)
	}
	if mismatched != 0 {
		t.Errorf("%d orders have a total that differs from their items", mismatched)
	}
}

func countHandoffs(t *testing.T, customerID string) int {
	t.Helper()
	var n int
	err := testPool.QueryRow(context.Background(),
		`SELECT count(*) FROM handoffs WHERE customer_id = $1`, customerID).Scan(&n)
	if err != nil {
		t.Fatalf("count handoffs: %v", err)
	}
	return n
}

func TestCreateHandoff(t *testing.T) {
	h := newServer(t)
	rec := request(t, h, http.MethodPost, "/v1/handoffs", "CUS-1001",
		`{"conversation_id":"c-1","reason":"frustration","summary":"  Müşteri kargonun gecikmesine sinirlendi.  "}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d; body = %s", rec.Code, rec.Body.String())
	}

	handoff := decode[store.Handoff](t, rec)
	if handoff.ConversationID != "c-1" || handoff.Reason != "frustration" || handoff.Status != "open" ||
		handoff.Summary != "Müşteri kargonun gecikmesine sinirlendi." {
		t.Errorf("unexpected handoff: %+v", handoff)
	}
	if n := countHandoffs(t, "CUS-1001"); n != 1 {
		t.Errorf("handoffs = %d, want 1", n)
	}
}

func TestRepeatedHandoffKeepsTheFirstRecord(t *testing.T) {
	h := newServer(t)
	first := decode[store.Handoff](t, request(t, h, http.MethodPost, "/v1/handoffs", "CUS-1001",
		`{"conversation_id":"c-1","reason":"customer_request","summary":"İlk özet"}`))
	second := decode[store.Handoff](t, request(t, h, http.MethodPost, "/v1/handoffs", "CUS-1001",
		`{"conversation_id":"c-1","reason":"frustration","summary":"İkinci özet"}`))

	if second.ID != first.ID || second.Summary != "İlk özet" || second.Reason != "customer_request" {
		t.Errorf("second request changed the handoff: first %+v, second %+v", first, second)
	}
	if n := countHandoffs(t, "CUS-1001"); n != 1 {
		t.Errorf("handoffs = %d, want 1", n)
	}
}

// Conversation IDs come from the browser, so two customers can pick the same one. Each must
// still get a record of their own, and neither can reach the other's.
func TestHandoffsAreScopedToTheCustomer(t *testing.T) {
	h := newServer(t)
	body := `{"conversation_id":"shared","reason":"customer_request","summary":"Temsilci istedi."}`
	a := decode[store.Handoff](t, request(t, h, http.MethodPost, "/v1/handoffs", "CUS-1001", body))
	b := decode[store.Handoff](t, request(t, h, http.MethodPost, "/v1/handoffs", "CUS-1002", body))

	if a.ID == b.ID {
		t.Fatalf("two customers share handoff %s", a.ID)
	}
	if countHandoffs(t, "CUS-1001") != 1 || countHandoffs(t, "CUS-1002") != 1 {
		t.Error("each customer should have exactly one handoff")
	}
}

func TestCreateHandoffValidatesBody(t *testing.T) {
	h := newServer(t)
	tests := map[string]struct {
		body, code string
	}{
		"not json":            {`nope`, "invalid_body"},
		"customer id in body": {`{"conversation_id":"c-1","reason":"frustration","summary":"x","customer_id":"CUS-1002"}`, "invalid_body"},
		"bad conversation id": {`{"conversation_id":"c:1","reason":"frustration","summary":"x"}`, "invalid_conversation_id"},
		"unknown reason":      {`{"conversation_id":"c-1","reason":"bored","summary":"x"}`, "invalid_reason"},
		"empty summary":       {`{"conversation_id":"c-1","reason":"frustration","summary":"  "}`, "invalid_summary"},
		"long summary":        {fmt.Sprintf(`{"conversation_id":"c-1","reason":"frustration","summary":%q}`, strings.Repeat("ş", maxSummaryChars+1)), "invalid_summary"},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			rec := request(t, h, http.MethodPost, "/v1/handoffs", "CUS-1001", tt.body)
			assertError(t, rec, http.StatusBadRequest, tt.code)
		})
	}
	if n := countHandoffs(t, "CUS-1001"); n != 0 {
		t.Errorf("invalid requests created %d handoffs", n)
	}
}

func TestCreateHandoffRequiresAToken(t *testing.T) {
	h := newServer(t)
	rec := request(t, h, http.MethodPost, "/v1/handoffs", "",
		`{"conversation_id":"c-1","reason":"frustration","summary":"x"}`)
	assertError(t, rec, http.StatusUnauthorized, "unauthorized")
}
