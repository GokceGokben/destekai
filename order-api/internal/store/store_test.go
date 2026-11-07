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

func TestPreparingEstimateSkipsWeekends(t *testing.T) {
	tests := []struct {
		name   string
		placed time.Time
		want   string
	}{
		// Monday plus five business days is the next Monday.
		{"placed on a Monday", time.Date(2026, 11, 2, 10, 0, 0, 0, istanbul), "2026-11-09"},
		// Friday: Mon, Tue, Wed, Thu, Fri of the next week.
		{"placed on a Friday", time.Date(2026, 11, 6, 10, 0, 0, 0, istanbul), "2026-11-13"},
		{"placed on a Saturday", time.Date(2026, 11, 7, 10, 0, 0, 0, istanbul), "2026-11-13"},
		// 22:30 UTC on Sunday is already Monday in Istanbul.
		{"late UTC evening counts as the next local day", time.Date(2026, 11, 8, 22, 30, 0, 0, time.UTC), "2026-11-16"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := preparingEstimate(tt.placed); got != tt.want {
				t.Errorf("preparingEstimate(%v) = %s, want %s", tt.placed, got, tt.want)
			}
		})
	}
}
