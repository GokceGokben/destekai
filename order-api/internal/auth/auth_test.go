package auth

import (
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var testSecret = []byte("test-secret-test-secret-test-secret")

func signRaw(t *testing.T, method jwt.SigningMethod, key any, c jwt.Claims) string {
	t.Helper()
	token, err := jwt.NewWithClaims(method, c).SignedString(key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return token
}

func mustVerify(t *testing.T, token string, err error) Session {
	t.Helper()
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	session, err := Verify(testSecret, token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	return session
}

func TestEachTokenKindRoundTrips(t *testing.T) {
	token, err := Issue(testSecret, "CUS-1001", time.Hour)
	customer := mustVerify(t, token, err)
	if customer != (Session{Subject: "CUS-1001", Role: RoleCustomer}) {
		t.Errorf("customer session = %+v", customer)
	}

	token, err = IssueAdmin(testSecret, "ADM-1001", time.Hour)
	admin := mustVerify(t, token, err)
	if admin != (Session{Subject: "ADM-1001", Role: RoleAdmin}) {
		t.Errorf("admin session = %+v", admin)
	}

	token, err = IssueView(testSecret, "CUS-1001", "ADM-1001", time.Minute)
	view := mustVerify(t, token, err)
	want := Session{Subject: "CUS-1001", Role: RoleCustomer, ReadOnly: true, ActorID: "ADM-1001"}
	if view != want {
		t.Errorf("view session = %+v, want %+v", view, want)
	}
}

func TestVerifyRejectsBadTokens(t *testing.T) {
	future := jwt.NewNumericDate(time.Now().Add(time.Hour))
	valid := claims{
		RegisteredClaims: jwt.RegisteredClaims{Issuer: issuer, Subject: "CUS-1001", ExpiresAt: future},
		Role:             RoleCustomer,
	}

	expired := valid
	expired.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Hour))
	noExpiry := valid
	noExpiry.ExpiresAt = nil
	wrongIssuer := valid
	wrongIssuer.Issuer = "someone-else"
	noSubject := valid
	noSubject.Subject = ""
	noRole := valid
	noRole.Role = ""
	unknownRole := valid
	unknownRole.Role = "superuser"
	readOnlyWithoutActor := valid
	readOnlyWithoutActor.ReadOnly = true
	actorWithoutReadOnly := valid
	actorWithoutReadOnly.Act = &Actor{Subject: "ADM-1001"}
	readOnlyAdmin := valid
	readOnlyAdmin.Role = RoleAdmin
	readOnlyAdmin.ReadOnly = true
	readOnlyAdmin.Act = &Actor{Subject: "ADM-1001"}
	emptyActor := valid
	emptyActor.ReadOnly = true
	emptyActor.Act = &Actor{}

	tests := map[string]string{
		"malformed":                  "not-a-jwt",
		"wrong secret":               signRaw(t, jwt.SigningMethodHS256, []byte("another-secret-another-secret-123"), valid),
		"alg none":                   signRaw(t, jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, valid),
		"other hmac":                 signRaw(t, jwt.SigningMethodHS512, testSecret, valid),
		"expired":                    signRaw(t, jwt.SigningMethodHS256, testSecret, expired),
		"no expiry":                  signRaw(t, jwt.SigningMethodHS256, testSecret, noExpiry),
		"wrong issuer":               signRaw(t, jwt.SigningMethodHS256, testSecret, wrongIssuer),
		"no subject":                 signRaw(t, jwt.SigningMethodHS256, testSecret, noSubject),
		"no role":                    signRaw(t, jwt.SigningMethodHS256, testSecret, noRole),
		"unknown role":               signRaw(t, jwt.SigningMethodHS256, testSecret, unknownRole),
		"read-only without admin":    signRaw(t, jwt.SigningMethodHS256, testSecret, readOnlyWithoutActor),
		"admin actor, not read-only": signRaw(t, jwt.SigningMethodHS256, testSecret, actorWithoutReadOnly),
		"read-only admin token":      signRaw(t, jwt.SigningMethodHS256, testSecret, readOnlyAdmin),
		"empty actor":                signRaw(t, jwt.SigningMethodHS256, testSecret, emptyActor),
	}
	for name, token := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := Verify(testSecret, token); !errors.Is(err, ErrInvalidToken) {
				t.Errorf("err = %v, want ErrInvalidToken", err)
			}
		})
	}
}
