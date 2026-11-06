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
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/destekai/order-api/internal/auth"
	"github.com/destekai/order-api/internal/httpapi"
	"github.com/destekai/order-api/internal/seed"
	"github.com/destekai/order-api/internal/store"
)

const (
	shutdownTimeout = 10 * time.Second
	purgeInterval   = 6 * time.Hour
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

	keys, err := auth.LoadKeys(os.Getenv("JWT_PRIVATE_KEY_FILE"))
	if err != nil {
		return fmt.Errorf("signing key (create one with cmd/keygen): %w", err)
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
		Handler:           httpapi.NewRouter(store.New(pool), keys, os.Getenv("DEV_LOGIN") == "true"),
		ReadHeaderTimeout: 5 * time.Second,
	}

	traceDays := envDays("TRACE_RETENTION_DAYS", 30)
	auditDays := envDays("AUDIT_RETENTION_DAYS", 365)
	go purgeOldRecords(ctx, store.New(pool), traceDays, auditDays)

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

// purgeOldRecords applies the retention at startup and then every purgeInterval,
// until the server shuts down.
func purgeOldRecords(ctx context.Context, s *store.Store, traceDays, auditDays int) {
	ticker := time.NewTicker(purgeInterval)
	defer ticker.Stop()
	for {
		traces, audits, err := s.PurgeOldRecords(ctx, traceDays, auditDays)
		if err != nil {
			slog.Warn("retention purge failed", "error", err)
		} else if traces+audits > 0 {
			slog.Info("retention purge", "traces", traces, "audit_rows", audits)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func envDays(name string, fallback int) int {
	days, err := strconv.Atoi(os.Getenv(name))
	if err != nil || days < 1 {
		return fallback
	}
	return days
}
