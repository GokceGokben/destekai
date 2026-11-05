package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/destekai/order-api/internal/auth"
	"github.com/destekai/order-api/internal/store"
)

const (
	customerPassword = "DestekAI-demo-2026"
	adminPassword    = "DestekAI-admin-2026"
)

// call sends a request with a raw token and a fixed client address.
func call(t *testing.T, h http.Handler, method, path, token, body, ip string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.RemoteAddr = ip + ":40000"
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func loginBody(email, password string) string {
	return `{"email":"` + email + `","password":"` + password + `"}`
}

func adminToken(t *testing.T, h http.Handler) string {
	t.Helper()
	rec := call(t, h, http.MethodPost, "/v1/admin/login", "",
		loginBody("admin@destekai.local", adminPassword), "10.0.0.1")
	if rec.Code != http.StatusOK {
		t.Fatalf("admin login: %d %s", rec.Code, rec.Body.String())
	}
	return decode[struct{ Token string }](t, rec).Token
}

func viewToken(t *testing.T, h http.Handler, admin, customerID string) string {
	t.Helper()
	rec := call(t, h, http.MethodPost, "/v1/admin/customers/"+customerID+"/view-token", admin, "", "10.0.0.1")
	if rec.Code != http.StatusOK {
		t.Fatalf("view token: %d %s", rec.Code, rec.Body.String())
	}
	return decode[struct{ Token string }](t, rec).Token
}

func TestCustomerLoginIgnoresEmailCase(t *testing.T) {
	h := newServer(t)
	rec := call(t, h, http.MethodPost, "/v1/auth/login", "",
		loginBody("  AYSE.Yilmaz@Example.com ", customerPassword), "10.0.0.1")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", rec.Code, rec.Body.String())
	}
	body := decode[struct {
		Token    string
		Customer store.Customer
	}](t, rec)
	session, err := auth.Verify(testSecret, body.Token)
	if err != nil || session.Subject != "CUS-1001" || session.Role != auth.RoleCustomer || session.ReadOnly {
		t.Errorf("session = %+v, err = %v", session, err)
	}
	if body.Customer.FullName != "Ayşe Yılmaz" {
		t.Errorf("customer = %+v", body.Customer)
	}
}

// An attacker must not learn which emails have accounts, from the answer or its timing.
func TestUnknownEmailAndWrongPasswordLookAlike(t *testing.T) {
	h := newServer(t)
	wrong := call(t, h, http.MethodPost, "/v1/auth/login", "",
		loginBody("ayse.yilmaz@example.com", "yanlis-sifre"), "10.0.0.1")
	unknown := call(t, h, http.MethodPost, "/v1/auth/login", "",
		loginBody("kimse@example.com", "yanlis-sifre"), "10.0.0.2")

	assertError(t, wrong, http.StatusUnauthorized, "invalid_credentials")
	if wrong.Body.String() != unknown.Body.String() || wrong.Code != unknown.Code {
		t.Errorf("responses differ: %q vs %q", wrong.Body.String(), unknown.Body.String())
	}
}

func TestUnknownEmailStillRunsBcrypt(t *testing.T) {
	start := time.Now()
	checkPassword("", false, "anything")
	// Cost 12 takes well over 50ms; a skipped comparison takes microseconds.
	if elapsed := time.Since(start); elapsed < 50*time.Millisecond {
		t.Errorf("comparison took %s; the dummy hash was not used", elapsed)
	}
}

func TestLoginIsLimitedPerEmail(t *testing.T) {
	h := newServer(t)
	for i := range maxFailures {
		rec := call(t, h, http.MethodPost, "/v1/auth/login", "",
			loginBody("ayse.yilmaz@example.com", "yanlis"), "10.0.1."+string(rune('1'+i)))
		assertError(t, rec, http.StatusUnauthorized, "invalid_credentials")
	}
	// Even the right password is refused now, from a new address too.
	rec := call(t, h, http.MethodPost, "/v1/auth/login", "",
		loginBody("ayse.yilmaz@example.com", customerPassword), "10.0.2.1")
	assertError(t, rec, http.StatusTooManyRequests, "too_many_attempts")
}

func TestLoginIsLimitedPerAddress(t *testing.T) {
	h := newServer(t)
	emails := []string{"a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"}
	for _, email := range emails {
		call(t, h, http.MethodPost, "/v1/auth/login", "", loginBody(email, "yanlis"), "10.0.3.1")
	}
	rec := call(t, h, http.MethodPost, "/v1/auth/login", "",
		loginBody("mehmet.demir@example.com", customerPassword), "10.0.3.1")
	assertError(t, rec, http.StatusTooManyRequests, "too_many_attempts")
}

func TestLimiterForgetsOldFailures(t *testing.T) {
	now := time.Now()
	limiter := newLoginLimiter(func() time.Time { return now })
	keys := []string{"email:x"}
	for range maxFailures {
		limiter.fail(keys)
	}
	if !limiter.blocked(keys) {
		t.Fatal("expected a block after the limit")
	}
	now = now.Add(failureWindow + time.Second)
	if limiter.blocked(keys) {
		t.Error("failures outside the window still block")
	}
}

func TestAdminLoginAndRoles(t *testing.T) {
	h := newServer(t)
	admin := adminToken(t, h)

	me := call(t, h, http.MethodGet, "/v1/admin/me", admin, "", "10.0.0.1")
	if me.Code != http.StatusOK || !strings.Contains(me.Body.String(), "ADM-1001") {
		t.Errorf("me: %d %s", me.Code, me.Body.String())
	}
	list := call(t, h, http.MethodGet, "/v1/admin/customers", admin, "", "10.0.0.1")
	if got := len(decode[struct{ Customers []store.Customer }](t, list).Customers); got != 10 {
		t.Errorf("admin sees %d customers, want 10", got)
	}

	// An admin token alone cannot read orders, and a customer token cannot use admin routes.
	assertError(t, call(t, h, http.MethodGet, "/v1/orders", admin, "", "10.0.0.1"),
		http.StatusForbidden, "wrong_role")
	customer, _ := auth.Issue(testSecret, "CUS-1001", time.Hour)
	assertError(t, call(t, h, http.MethodGet, "/v1/admin/customers", customer, "", "10.0.0.1"),
		http.StatusForbidden, "wrong_role")
}

func TestViewTokenReadsButNeverWrites(t *testing.T) {
	h := newServer(t)
	view := viewToken(t, h, adminToken(t, h), "CUS-1001")

	orders := call(t, h, http.MethodGet, "/v1/orders", view, "", "10.0.0.1")
	if orders.Code != http.StatusOK || !strings.Contains(orders.Body.String(), "DA-100001") {
		t.Errorf("orders: %d %s", orders.Code, orders.Body.String())
	}
	assertError(t, call(t, h, http.MethodPost, "/v1/orders/DA-100001/returns", view,
		`{"reason":"Beğenmedim"}`, "10.0.0.1"), http.StatusForbidden, "read_only_session")
	assertError(t, call(t, h, http.MethodPost, "/v1/handoffs", view,
		`{"conversation_id":"c","reason":"customer_request","summary":"x"}`, "10.0.0.1"),
		http.StatusForbidden, "read_only_session")
	// The view is of one customer: another customer's order stays a 404.
	assertError(t, call(t, h, http.MethodGet, "/v1/orders/DA-100004", view, "", "10.0.0.1"),
		http.StatusNotFound, "order_not_found")
	if n := countReturns(t, "DA-100001"); n != 0 {
		t.Errorf("a read-only session created %d returns", n)
	}
}

func TestEveryViewIsAudited(t *testing.T) {
	h := newServer(t)
	admin := adminToken(t, h)
	viewToken(t, h, admin, "CUS-1001")
	viewToken(t, h, admin, "CUS-1001")

	var n int
	err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM admin_audit_log
		WHERE admin_id = 'ADM-1001' AND customer_id = 'CUS-1001' AND action = 'view_customer'`).Scan(&n)
	if err != nil || n != 2 {
		t.Errorf("audit rows = %d, err = %v; want 2", n, err)
	}

	missing := call(t, h, http.MethodPost, "/v1/admin/customers/CUS-9999/view-token", admin, "", "10.0.0.1")
	assertError(t, missing, http.StatusNotFound, "customer_not_found")
}
