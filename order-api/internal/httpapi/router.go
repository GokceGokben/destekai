// Package httpapi exposes the store over HTTP.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
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
)

type contextKey struct{}

type api struct {
	store     *store.Store
	jwtSecret []byte
}

// NewRouter builds the HTTP handler. All /v1 routes require a session token.
func NewRouter(s *store.Store, jwtSecret []byte) http.Handler {
	a := &api{store: s, jwtSecret: jwtSecret}

	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.Logger, middleware.Recoverer, middleware.Timeout(requestTimeout))
	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "resource not found")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	})

	r.Get("/health", a.health)
	r.Route("/v1", func(r chi.Router) {
		r.Use(a.requireCustomer)
		r.Get("/orders", a.listOrders)
		// The pattern keeps malformed IDs, such as ones with NUL bytes, away from SQL.
		r.Route("/orders/{id:DA-[0-9]{6}}", func(r chi.Router) {
			r.Get("/", a.getOrder)
			r.Get("/shipment", a.getShipment)
			r.Post("/returns", a.createReturn)
		})
	})
	return r
}

// requireCustomer puts the token's customer ID into the request context. It is
// the only place handlers can get a customer ID from.
func (a *api) requireCustomer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized", "missing bearer token")
			return
		}
		customerID, err := auth.Verify(a.jwtSecret, token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "invalid token")
			return
		}
		ctx := context.WithValue(r.Context(), contextKey{}, customerID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func customerID(r *http.Request) string {
	return r.Context().Value(contextKey{}).(string)
}

func (a *api) health(w http.ResponseWriter, r *http.Request) {
	if err := a.store.Ping(r.Context()); err != nil {
		slog.Error("health check failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, "database_unavailable", "database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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
