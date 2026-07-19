package workerlimit

import (
	"context"
	"sync"
)

// Weighted limits concurrent work by an estimated resource cost instead of a
// job count. A job larger than the whole budget is treated as using the whole
// budget so that it can still make progress while running alone.
type Weighted struct {
	mu      sync.Mutex
	limit   int64
	used    int64
	changed chan struct{}
}

func NewWeighted(limit int64) *Weighted {
	if limit < 1 {
		limit = 1
	}
	return &Weighted{
		limit:   limit,
		changed: make(chan struct{}),
	}
}

// Acquire waits until weight fits in the remaining budget and returns an
// idempotent release function.
func (l *Weighted) Acquire(ctx context.Context, weight int64) (func(), error) {
	if weight < 1 {
		weight = 1
	}
	if weight > l.limit {
		weight = l.limit
	}

	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		l.mu.Lock()
		if l.used+weight <= l.limit {
			l.used += weight
			l.mu.Unlock()

			var once sync.Once
			return func() {
				once.Do(func() {
					l.mu.Lock()
					l.used -= weight
					close(l.changed)
					l.changed = make(chan struct{})
					l.mu.Unlock()
				})
			}, nil
		}
		changed := l.changed
		l.mu.Unlock()

		select {
		case <-changed:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}
