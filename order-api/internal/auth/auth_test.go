package auth

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var testKeys = mustKeys()

func mustKeys() Keys {
	keys, err := GenerateKeys()
	if err != nil {
		panic(err)
	}
	return keys
}

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
	session, err := Verify(testKeys.Public, token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	return session
}

func TestEachTokenKindRoundTrips(t *testing.T) {
	token, err := Issue(testKeys.Private, "CUS-1001", time.Hour)
	customer := mustVerify(t, token, err)
	if customer != (Session{Subject: "CUS-1001", Role: RoleCustomer}) {
		t.Errorf("customer session = %+v", customer)
	}

	token, err = IssueAdmin(testKeys.Private, "ADM-1001", time.Hour)
	admin := mustVerify(t, token, err)
	if admin != (Session{Subject: "ADM-1001", Role: RoleAdmin}) {
		t.Errorf("admin session = %+v", admin)
	}

	token, err = IssueView(testKeys.Private, "CUS-1001", "ADM-1001", time.Minute)
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
		"malformed":   "not-a-jwt",
		"another key": signRaw(t, jwt.SigningMethodEdDSA, mustKeys().Private, valid),
		"alg none":    signRaw(t, jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, valid),
		// Algorithm confusion: an HMAC "signed" with the public key, which anyone may have.
		"hmac with the public key":   signRaw(t, jwt.SigningMethodHS256, []byte(testKeys.Public), valid),
		"expired":                    signRaw(t, jwt.SigningMethodEdDSA, testKeys.Private, expired),
		"no expiry":                  signRaw(t, jwt.SigningMethodEdDSA, testKeys.Private, noExpiry),
		"wrong issuer":               signRaw(t, jwt.SigningMethodEdDSA, testKeys.Private, wrongIssuer),
		"no subject":                 signRaw(t, jwt.SigningMethodEdDSA, testKeys.Private, noSubject),
		"no role":                    signRaw(t, jwt.SigningMethodEdDSA, testKeys.Private, noRole),
		"unknown role":               signRaw(t, jwt.SigningMethodEdDSA, testKeys.Private, unknownRole),
		"read-only without admin":    signRaw(t, jwt.SigningMethodEdDSA, testKeys.Private, readOnlyWithoutActor),
		"admin actor, not read-only": signRaw(t, jwt.SigningMethodEdDSA, testKeys.Private, actorWithoutReadOnly),
		"read-only admin token":      signRaw(t, jwt.SigningMethodEdDSA, testKeys.Private, readOnlyAdmin),
		"empty actor":                signRaw(t, jwt.SigningMethodEdDSA, testKeys.Private, emptyActor),
	}
	for name, token := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := Verify(testKeys.Public, token); !errors.Is(err, ErrInvalidToken) {
				t.Errorf("err = %v, want ErrInvalidToken", err)
			}
		})
	}
}

func TestKeysSurviveThePEMRoundTrip(t *testing.T) {
	private, public, err := testKeys.PEM()
	if err != nil {
		t.Fatalf("PEM: %v", err)
	}
	path := filepath.Join(t.TempDir(), "jwt_private.pem")
	if err := os.WriteFile(path, private, 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadKeys(path)
	if err != nil {
		t.Fatalf("LoadKeys: %v", err)
	}
	if !loaded.Private.Equal(testKeys.Private) || !loaded.Public.Equal(testKeys.Public) {
		t.Error("loaded keys differ from the written ones")
	}
	if !strings.Contains(string(public), "BEGIN PUBLIC KEY") {
		t.Errorf("public key PEM = %q", public)
	}
}
