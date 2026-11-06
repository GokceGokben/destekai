// Command devtoken prints a session token for local development.
package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/destekai/order-api/internal/auth"
)

func main() {
	customer := flag.String("customer", "CUS-1001", "customer ID to put in the token")
	ttl := flag.Duration("ttl", 24*time.Hour, "token lifetime")
	flag.Parse()

	keys, err := auth.LoadKeys(os.Getenv("JWT_PRIVATE_KEY_FILE"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	token, err := auth.Issue(keys.Private, *customer, *ttl)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(token)
}
