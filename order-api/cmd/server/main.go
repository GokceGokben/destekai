// Command server runs the order API.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/destekai/order-api/internal/httpapi"
	"github.com/destekai/order-api/internal/seed"
	"github.com/destekai/order-api/internal/store"
)

const (
	minSecretLength = 32
	shutdownTimeout = 10 * time.Second
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	secret := os.Getenv("JWT_SECRET")
	if len(secret) < minSecretLength {
		return fmt.Errorf("JWT_SECRET must be at least %d characters", minSecretLength)
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return fmt.Errorf("create connection pool: %w", err)
	}
	defer pool.Close()

	if err := store.Migrate(ctx, pool); err != nil {
		return err
	}
	if password := os.Getenv("AGENT_DB_PASSWORD"); password != "" {
		if err := store.SetAgentPassword(ctx, pool, password); err != nil {
			return err
		}
	}
	if os.Getenv("SEED_DATA") == "true" {
		if err := seed.ApplyIfEmpty(ctx, pool); err != nil {
			return err
		}
	}

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           httpapi.NewRouter(store.New(pool), []byte(secret), os.Getenv("DEV_LOGIN") == "true"),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errs := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", server.Addr)
		errs <- server.ListenAndServe()
	}()

	select {
	case err := <-errs:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		// ctx is already cancelled, so the shutdown needs a context of its own.
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
}
