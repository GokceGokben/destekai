package httpapi

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/destekai/order-api/internal/auth"
	"github.com/destekai/order-api/internal/store"
)

const (
	sessionTTL    = 8 * time.Hour
	viewTokenTTL  = 15 * time.Minute
	maxFailures   = 5
	failureWindow = 15 * time.Minute
)

// A bcrypt hash (cost 12) of a password no account has. Comparing against it when the
// email is unknown makes that answer take as long as a wrong password.
var dummyHash = []byte("$2a$12$x0cmB9Z2ntEhQ86mZ4xsfeFoIMbyng6Xkmd.ZhMR.kisJsWAnY.rO")

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func decodeCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	var body credentials
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil || body.Email == "" || body.Password == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "request body must be JSON with email and password")
		return credentials{}, false
	}
	body.Email = strings.ToLower(strings.TrimSpace(body.Email))
	return body, true
}

// checkPassword runs bcrypt even when there is no account, against dummyHash.
func checkPassword(hash string, found bool, password string) bool {
	if !found {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// login is shared by both logins: the limit check, the lookup and the comparison
// happen the same way, and every failure looks the same to the client.
func (a *api) login(
	w http.ResponseWriter, r *http.Request, lookup func(email string) (string, error),
) bool {
	body, ok := decodeCredentials(w, r)
	if !ok {
		return false
	}
	keys := []string{"email:" + body.Email, "ip:" + clientIP(r)}
	if a.logins.blocked(keys) {
		writeError(w, http.StatusTooManyRequests, "too_many_attempts", "too many failed attempts, try again later")
		return false
	}

	hash, err := lookup(body.Email)
	if err != nil && !errors.Is(err, store.ErrNoAccount) {
		writeStoreError(w, err)
		return false
	}
	if !checkPassword(hash, err == nil, body.Password) {
		a.logins.fail(keys)
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "email or password is wrong")
		return false
	}
	a.logins.reset("email:" + body.Email)
	return true
}

// clientIP drops the port: it changes with every connection, so counting
// "ip:port" would never reach the limit.
func clientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func (a *api) customerLogin(w http.ResponseWriter, r *http.Request) {
	var id string
	ok := a.login(w, r, func(email string) (string, error) {
		var hash string
		var err error
		id, hash, err = a.store.CustomerCredentials(r.Context(), email)
		return hash, err
	})
	if !ok {
		return
	}
	customer, err := a.store.GetCustomer(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	token, err := auth.Issue(a.keys.Private, id, sessionTTL)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "customer": customer})
}

func (a *api) adminLogin(w http.ResponseWriter, r *http.Request) {
	var admin store.Admin
	ok := a.login(w, r, func(email string) (string, error) {
		var hash string
		var err error
		admin, hash, err = a.store.AdminCredentials(r.Context(), email)
		return hash, err
	})
	if !ok {
		return
	}
	token, err := auth.IssueAdmin(a.keys.Private, admin.ID, sessionTTL)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "admin": admin})
}

// adminMe answers nginx's auth_request for the evaluation report as well as the UI.
func (a *api) adminMe(w http.ResponseWriter, r *http.Request) {
	admin, err := a.store.GetAdmin(r.Context(), sessionOf(r).Subject)
	if errors.Is(err, store.ErrNoAccount) {
		writeError(w, http.StatusUnauthorized, "unauthorized", "admin no longer exists")
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"admin": admin})
}

func (a *api) listCustomersForAdmin(w http.ResponseWriter, r *http.Request) {
	customers, err := a.store.ListCustomers(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"customers": customers})
}

// issueViewToken gives an admin a short read-only token for one customer, and
// records that the admin looked.
func (a *api) issueViewToken(w http.ResponseWriter, r *http.Request) {
	adminID := sessionOf(r).Subject
	customer, err := a.store.GetCustomer(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := a.store.RecordAdminView(r.Context(), adminID, customer.ID); err != nil {
		writeStoreError(w, err)
		return
	}
	token, err := auth.IssueView(a.keys.Private, customer.ID, adminID, viewTokenTTL)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "customer": customer})
}

// loginLimiter counts failed logins per key in a sliding window. It lives in
// memory, which suits a single instance; several would need a shared store.
type loginLimiter struct {
	mu       sync.Mutex
	now      func() time.Time
	failures map[string][]time.Time
}

func newLoginLimiter(now func() time.Time) *loginLimiter {
	return &loginLimiter{now: now, failures: map[string][]time.Time{}}
}

func (l *loginLimiter) recent(key string) []time.Time {
	cutoff := l.now().Add(-failureWindow)
	kept := l.failures[key][:0]
	for _, at := range l.failures[key] {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	if len(kept) == 0 {
		delete(l.failures, key)
		return nil
	}
	l.failures[key] = kept
	return kept
}

func (l *loginLimiter) blocked(keys []string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, key := range keys {
		if len(l.recent(key)) >= maxFailures {
			return true
		}
	}
	return false
}

func (l *loginLimiter) fail(keys []string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, key := range keys {
		l.failures[key] = append(l.recent(key), l.now())
	}
}

func (l *loginLimiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, key)
}
