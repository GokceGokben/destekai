// Command keygen writes a new Ed25519 key pair for signing session tokens:
// jwt_private.pem for the order API, jwt_public.pem for services that only verify.
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/destekai/order-api/internal/auth"
)

func main() {
	dir := flag.String("dir", "secrets", "directory to write the key files to")
	flag.Parse()
	if err := run(*dir); err != nil {
		fmt.Fprintln(os.Stderr, "keygen:", err)
		os.Exit(1)
	}
}

func run(dir string) error {
	privatePath := filepath.Join(dir, "jwt_private.pem")
	publicPath := filepath.Join(dir, "jwt_public.pem")
	// Replacing a key signs everyone out, so it is never done by accident.
	if _, err := os.Stat(privatePath); err == nil {
		return errors.New(privatePath + " already exists; delete it first to rotate the key")
	}

	keys, err := auth.GenerateKeys()
	if err != nil {
		return err
	}
	private, public, err := keys.PEM()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(privatePath, private, 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(publicPath, public, 0o644); err != nil {
		return err
	}
	fmt.Println("wrote", privatePath, "and", publicPath)
	return nil
}
