package auth

import (
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var testSecret = []byte("test-secret-test-secret-test-secret")

func sign(t *testing.T, method jwt.SigningMethod, key any, claims jwt.Claims) string {
	t.Helper()
	token, err := jwt.NewWithClaims(method, claims).SignedString(key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return token
}

func TestVerifyReturnsCustomerID(t *testing.T) {
	token, err := Issue(testSecret, "CUS-1001", time.Hour)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	got, err := Verify(testSecret, token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if got != "CUS-1001" {
		t.Errorf("customer = %q, want CUS-1001", got)
	}
}

func TestVerifyRejectsBadTokens(t *testing.T) {
	future := jwt.NewNumericDate(time.Now().Add(time.Hour))
	valid := jwt.RegisteredClaims{Issuer: issuer, Subject: "CUS-1001", ExpiresAt: future}

	expired := valid
	expired.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Hour))
	noExpiry := valid
	noExpiry.ExpiresAt = nil
	wrongIssuer := valid
	wrongIssuer.Issuer = "someone-else"
	noSubject := valid
	noSubject.Subject = ""

	tests := map[string]string{
		"malformed":    "not-a-jwt",
		"wrong secret": sign(t, jwt.SigningMethodHS256, []byte("another-secret-another-secret-123"), valid),
		"alg none":     sign(t, jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, valid),
		"other hmac":   sign(t, jwt.SigningMethodHS512, testSecret, valid),
		"expired":      sign(t, jwt.SigningMethodHS256, testSecret, expired),
		"no expiry":    sign(t, jwt.SigningMethodHS256, testSecret, noExpiry),
		"wrong issuer": sign(t, jwt.SigningMethodHS256, testSecret, wrongIssuer),
		"no subject":   sign(t, jwt.SigningMethodHS256, testSecret, noSubject),
	}
	for name, token := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := Verify(testSecret, token); !errors.Is(err, ErrInvalidToken) {
				t.Errorf("err = %v, want ErrInvalidToken", err)
			}
		})
	}
}
