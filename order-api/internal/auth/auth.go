// Package auth issues and verifies the mock session JWT. The token subject is
// the only source of a customer's identity in this service.
package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const issuer = "destekai"

// ErrInvalidToken covers every verification failure. Callers do not need to
// know why a token was rejected, and neither should the client.
var ErrInvalidToken = errors.New("invalid token")

// Issue signs a token for customerID that expires after ttl.
func Issue(secret []byte, customerID string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Issuer:    issuer,
		Subject:   customerID,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return token, nil
}

// Verify checks the signature and claims and returns the customer ID.
// Pinning the algorithm blocks "alg: none" and algorithm-confusion tokens.
func Verify(secret []byte, tokenString string) (string, error) {
	claims := &jwt.RegisteredClaims{}
	_, err := jwt.ParseWithClaims(tokenString, claims,
		func(*jwt.Token) (any, error) { return secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil || claims.Subject == "" {
		return "", ErrInvalidToken
	}
	return claims.Subject, nil
}
