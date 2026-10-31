package store

import (
	"errors"
	"testing"
	"time"
)

func TestCheckReturnable(t *testing.T) {
	delivered := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name   string
		status string
		now    time.Time
		want   error
	}{
		{"just delivered", "delivered", delivered, nil},
		{"exactly at the limit", "delivered", delivered.Add(returnWindow), nil},
		{"one second late", "delivered", delivered.Add(returnWindow + time.Second), ErrReturnWindowExpired},
		{"still preparing", "preparing", delivered, ErrNotDelivered},
		{"in transit", "shipped", delivered, ErrNotDelivered},
		{"cancelled", "cancelled", delivered, ErrNotDelivered},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := checkReturnable(tt.status, delivered, tt.now); !errors.Is(err, tt.want) {
				t.Errorf("err = %v, want %v", err, tt.want)
			}
		})
	}
}
