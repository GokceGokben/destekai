// Package auth issues and verifies the session JWTs. The token subject is the
// only source of identity in this service.
package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const issuer = "destekai"

// Roles carried in the "role" claim.
const (
	RoleCustomer = "customer"
	RoleAdmin    = "admin"
)

// ErrInvalidToken covers every verification failure. Callers do not need to
// know why a token was rejected, and neither should the client.
var ErrInvalidToken = errors.New("invalid token")

// Actor names who acts on the subject's behalf, as in RFC 8693's "act" claim.
type Actor struct {
	Subject string `json:"sub"`
}

type claims struct {
	jwt.RegisteredClaims
	Role     string `json:"role"`
	ReadOnly bool   `json:"readonly,omitempty"`
	Act      *Actor `json:"act,omitempty"`
}

// Session is a verified token.
type Session struct {
	// Subject is a customer ID for customer tokens, an admin ID for admin tokens.
	Subject string
	Role    string
	// ReadOnly is set when an admin views a customer; ActorID is that admin.
	ReadOnly bool
	ActorID  string
}

func sign(secret []byte, c claims, ttl time.Duration) (string, error) {
	now := time.Now()
	c.Issuer = issuer
	c.IssuedAt = jwt.NewNumericDate(now)
	c.ExpiresAt = jwt.NewNumericDate(now.Add(ttl))
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(secret)
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return token, nil
}

// Issue signs a customer token for customerID that expires after ttl.
func Issue(secret []byte, customerID string, ttl time.Duration) (string, error) {
	return sign(secret, claims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: customerID},
		Role:             RoleCustomer,
	}, ttl)
}

// IssueAdmin signs an admin token. It cannot read orders: order routes need a
// customer token, which an admin gets per customer from IssueView.
func IssueAdmin(secret []byte, adminID string, ttl time.Duration) (string, error) {
	return sign(secret, claims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: adminID},
		Role:             RoleAdmin,
	}, ttl)
}

// IssueView signs a read-only customer token for an admin. The subject stays the
// customer, so every ownership check applies unchanged, and the actor records
// which admin is looking.
func IssueView(secret []byte, customerID, adminID string, ttl time.Duration) (string, error) {
	return sign(secret, claims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: customerID},
		Role:             RoleCustomer,
		ReadOnly:         true,
		Act:              &Actor{Subject: adminID},
	}, ttl)
}

// Verify checks the signature and claims.
// Pinning the algorithm blocks "alg: none" and algorithm-confusion tokens.
func Verify(secret []byte, tokenString string) (Session, error) {
	c := &claims{}
	_, err := jwt.ParseWithClaims(tokenString, c,
		func(*jwt.Token) (any, error) { return secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil || c.Subject == "" {
		return Session{}, ErrInvalidToken
	}
	switch {
	case c.Role == RoleAdmin && !c.ReadOnly && c.Act == nil:
	case c.Role == RoleCustomer && c.ReadOnly == (c.Act != nil):
		// A read-only token must name its admin, and only such a token may.
	default:
		return Session{}, ErrInvalidToken
	}
	session := Session{Subject: c.Subject, Role: c.Role, ReadOnly: c.ReadOnly}
	if c.Act != nil {
		if c.Act.Subject == "" {
			return Session{}, ErrInvalidToken
		}
		session.ActorID = c.Act.Subject
	}
	return session, nil
}
