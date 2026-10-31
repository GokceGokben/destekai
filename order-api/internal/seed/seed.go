// Package seed loads the Turkish demo data.
package seed

import (
	"context"
	_ "embed"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed seed.sql
var seedSQL string

// Apply replaces all data with the demo set in a single transaction.
func Apply(ctx context.Context, pool *pgxpool.Pool) error {
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, seedSQL)
		return err
	})
	if err != nil {
		return fmt.Errorf("apply seed: %w", err)
	}
	return nil
}

// ApplyIfEmpty seeds a fresh database and leaves an existing one untouched,
// which keeps restarts from wiping data.
func ApplyIfEmpty(ctx context.Context, pool *pgxpool.Pool) error {
	var hasCustomers bool
	err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM customers)`).Scan(&hasCustomers)
	if err != nil {
		return fmt.Errorf("check seed state: %w", err)
	}
	if hasCustomers {
		return nil
	}
	return Apply(ctx, pool)
}
