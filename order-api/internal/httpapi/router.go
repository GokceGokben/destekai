// Package httpapi exposes the store over HTTP.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/destekai/order-api/internal/auth"
	"github.com/destekai/order-api/internal/store"
)

const (
	requestTimeout  = 10 * time.Second
	maxBodyBytes    = 4 << 10
	maxReasonLength = 500
	maxSummaryChars = 1000
	devTokenTTL     = 8 * time.Hour
)

type contextKey struct{}

type api struct {
	store  *store.Store
	keys   auth.Keys
	logins *loginLimiter
}

// NewRouter builds the HTTP handler. All /v1 routes require a session token,
// except /v1/dev, which exists only when devLogin is true: it hands out a token
// for any customer, so it must stay off anywhere but a demo.
func NewRouter(s *store.Store, keys auth.Keys, devLogin bool) http.Handler {
	a := &api{store: s, keys: keys, logins: newLoginLimiter(time.Now)}

	r := chi.NewRouter()
	// RealIP trusts X-Real-IP, which nginx sets; the service itself is bound to
	// localhost, so no one else can send it. The login rate limit counts per IP.
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Logger, middleware.Recoverer,
		middleware.Timeout(requestTimeout))
	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "resource not found")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	})

	r.Get("/health", a.health)
	r.Route("/v1", func(r chi.Router) {
		if devLogin {
			r.Get("/dev/customers", a.listDevCustomers)
			r.Post("/dev/token", a.issueDevToken)
		}
		r.Post("/auth/login", a.customerLogin)
		r.Post("/admin/login", a.adminLogin)
		r.Group(func(r chi.Router) {
			r.Use(a.requireRole(auth.RoleAdmin))
			r.Get("/admin/me", a.adminMe)
			r.Get("/admin/customers", a.listCustomersForAdmin)
			r.Post("/admin/customers/{id:CUS-[0-9]{4}}/view-token", a.issueViewToken)
		})
		r.Group(func(r chi.Router) {
			r.Use(a.requireRole(auth.RoleCustomer), rejectWritesWhenReadOnly)
			r.Get("/orders", a.listOrders)
			r.Post("/handoffs", a.createHandoff)
			// The pattern keeps malformed IDs, such as ones with NUL bytes, away from SQL.
			r.Route("/orders/{id:DA-[0-9]{6}}", func(r chi.Router) {
				r.Get("/", a.getOrder)
				r.Get("/shipment", a.getShipment)
				r.Post("/returns", a.createReturn)
			})
		})
	})
	return r
}

// requireRole puts the verified session into the request context. It is the only
// place handlers can get an identity from. An admin token cannot reach the order
// routes: an admin reads a customer's orders only through a view token.
func (a *api) requireRole(role string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok {
				writeError(w, http.StatusUnauthorized, "unauthorized", "missing bearer token")
				return
			}
			session, err := auth.Verify(a.keys.Public, token)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "unauthorized", "invalid token")
				return
			}
			if session.Role != role {
				writeError(w, http.StatusForbidden, "wrong_role", "this token cannot use this route")
				return
			}
			ctx := context.WithValue(r.Context(), contextKey{}, session)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// rejectWritesWhenReadOnly enforces the admin view on the server: hiding buttons
// is not enough. It covers every write route, including ones added later.
func rejectWritesWhenReadOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if sessionOf(r).ReadOnly && r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, http.StatusForbidden, "read_only_session", "this session is read-only")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func sessionOf(r *http.Request) auth.Session {
	return r.Context().Value(contextKey{}).(auth.Session)
}

func customerID(r *http.Request) string {
	return sessionOf(r).Subject
}

func (a *api) health(w http.ResponseWriter, r *http.Request) {
	if err := a.store.Ping(r.Context()); err != nil {
		slog.Error("health check failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, "database_unavailable", "database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *api) listDevCustomers(w http.ResponseWriter, r *http.Request) {
	customers, err := a.store.ListCustomers(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"customers": customers})
}

func (a *api) issueDevToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CustomerID string `json:"customer_id"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "request body must be JSON with a customer_id field")
		return
	}

	customers, err := a.store.ListCustomers(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	i := slices.IndexFunc(customers, func(c store.Customer) bool { return c.ID == body.CustomerID })
	if i < 0 {
		writeError(w, http.StatusNotFound, "customer_not_found", "customer not found")
		return
	}

	token, err := auth.Issue(a.keys.Private, body.CustomerID, devTokenTTL)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "customer": customers[i]})
}

func (a *api) listOrders(w http.ResponseWriter, r *http.Request) {
	orders, err := a.store.ListOrders(r.Context(), customerID(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"orders": orders})
}

func (a *api) getOrder(w http.ResponseWriter, r *http.Request) {
	order, err := a.store.GetOrder(r.Context(), customerID(r), chi.URLParam(r, "id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (a *api) getShipment(w http.ResponseWriter, r *http.Request) {
	shipment, err := a.store.GetShipment(r.Context(), customerID(r), chi.URLParam(r, "id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, shipment)
}

func (a *api) createReturn(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Reason string `json:"reason"`
	}
	// Unknown fields are rejected so that a customer_id in the body fails
	// loudly instead of looking as if it had been honored.
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "request body must be JSON with a reason field")
		return
	}

	reason := strings.TrimSpace(body.Reason)
	if reason == "" || utf8.RuneCountInString(reason) > maxReasonLength {
		writeError(w, http.StatusBadRequest, "invalid_reason", "reason must be between 1 and 500 characters")
		return
	}

	ret, err := a.store.CreateReturn(r.Context(), customerID(r), chi.URLParam(r, "id"), reason, time.Now())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, ret)
}

var (
	conversationIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)
	handoffReasons        = []string{"customer_request", "repeated_failures", "frustration", "agent_decision"}
)

func (a *api) createHandoff(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ConversationID string `json:"conversation_id"`
		Reason         string `json:"reason"`
		Summary        string `json:"summary"`
	}
	// As with returns, a customer_id in the body is an error, not something to ignore.
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "request body must be JSON with conversation_id, reason and summary")
		return
	}

	summary := strings.TrimSpace(body.Summary)
	switch {
	case !conversationIDPattern.MatchString(body.ConversationID):
		writeError(w, http.StatusBadRequest, "invalid_conversation_id", "conversation_id must be 1-64 letters, digits or dashes")
		return
	case !slices.Contains(handoffReasons, body.Reason):
		writeError(w, http.StatusBadRequest, "invalid_reason", "reason must be customer_request, repeated_failures, frustration or agent_decision")
		return
	case summary == "" || utf8.RuneCountInString(summary) > maxSummaryChars:
		writeError(w, http.StatusBadRequest, "invalid_summary", "summary must be between 1 and 1000 characters")
		return
	}

	handoff, err := a.store.CreateHandoff(r.Context(), customerID(r), body.ConversationID, body.Reason, summary)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, handoff)
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "order_not_found", "order not found")
	case errors.Is(err, store.ErrNoShipment):
		writeError(w, http.StatusNotFound, "shipment_not_found", "order has no shipment yet")
	case errors.Is(err, store.ErrNotDelivered):
		writeError(w, http.StatusConflict, "order_not_delivered", "only delivered orders can be returned")
	case errors.Is(err, store.ErrReturnWindowExpired):
		writeError(w, http.StatusConflict, "return_window_expired", "the 14-day return window has passed")
	case errors.Is(err, store.ErrCustomerNotFound):
		writeError(w, http.StatusNotFound, "customer_not_found", "customer not found")
	case errors.Is(err, store.ErrReturnExists):
		writeError(w, http.StatusConflict, "return_already_exists", "order already has a return")
	default:
		slog.Error("request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "internal error")
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"code": code, "message": message})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("write response", "error", err)
	}
}
