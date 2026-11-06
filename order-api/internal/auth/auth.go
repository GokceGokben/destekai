// Package auth issues and verifies the session JWTs. The token subject is the
// only source of identity in this service.
//
// Tokens are signed with Ed25519. Only this service holds the private key; the agent
// service gets the public key and can verify tokens but never create one.
package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
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

// Keys is the signing key pair. The public half is derived from the private one.
type Keys struct {
	Private ed25519.PrivateKey
	Public  ed25519.PublicKey
}

// GenerateKeys makes a new key pair, for cmd/keygen and for tests.
func GenerateKeys() (Keys, error) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return Keys{}, fmt.Errorf("generate key: %w", err)
	}
	return Keys{Private: private, Public: public}, nil
}

// LoadKeys reads a PKCS #8 PEM private key, as written by cmd/keygen.
func LoadKeys(path string) (Keys, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Keys{}, fmt.Errorf("read private key: %w", err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return Keys{}, errors.New("private key file is not PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return Keys{}, fmt.Errorf("parse private key: %w", err)
	}
	private, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return Keys{}, errors.New("private key is not Ed25519")
	}
	return Keys{Private: private, Public: private.Public().(ed25519.PublicKey)}, nil
}

// PEM encodes the key pair: PKCS #8 for the private key, PKIX for the public key.
func (k Keys) PEM() (private, public []byte, err error) {
	der, err := x509.MarshalPKCS8PrivateKey(k.Private)
	if err != nil {
		return nil, nil, fmt.Errorf("encode private key: %w", err)
	}
	pubDER, err := x509.MarshalPKIXPublicKey(k.Public)
	if err != nil {
		return nil, nil, fmt.Errorf("encode public key: %w", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}), nil
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

func sign(key ed25519.PrivateKey, c claims, ttl time.Duration) (string, error) {
	now := time.Now()
	c.Issuer = issuer
	c.IssuedAt = jwt.NewNumericDate(now)
	c.ExpiresAt = jwt.NewNumericDate(now.Add(ttl))
	token, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, c).SignedString(key)
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return token, nil
}

// Issue signs a customer token for customerID that expires after ttl.
func Issue(key ed25519.PrivateKey, customerID string, ttl time.Duration) (string, error) {
	return sign(key, claims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: customerID},
		Role:             RoleCustomer,
	}, ttl)
}

// IssueAdmin signs an admin token. It cannot read orders: order routes need a
// customer token, which an admin gets per customer from IssueView.
func IssueAdmin(key ed25519.PrivateKey, adminID string, ttl time.Duration) (string, error) {
	return sign(key, claims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: adminID},
		Role:             RoleAdmin,
	}, ttl)
}

// IssueView signs a read-only customer token for an admin. The subject stays the
// customer, so every ownership check applies unchanged, and the actor records
// which admin is looking.
func IssueView(key ed25519.PrivateKey, customerID, adminID string, ttl time.Duration) (string, error) {
	return sign(key, claims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: customerID},
		Role:             RoleCustomer,
		ReadOnly:         true,
		Act:              &Actor{Subject: adminID},
	}, ttl)
}

// Verify checks the signature and claims. Pinning the algorithm blocks "alg: none"
// and algorithm confusion, such as an HS256 token "signed" with the public key.
func Verify(key ed25519.PublicKey, tokenString string) (Session, error) {
	c := &claims{}
	_, err := jwt.ParseWithClaims(tokenString, c,
		func(*jwt.Token) (any, error) { return key, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
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
