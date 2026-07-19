package workerlimit

import (
	"context"
	"sync"
)

// Limiter is a dynamically resizable concurrency limit. Changes apply to new
// acquisitions immediately; work that already holds a slot is allowed to
// finish on the previous limit.
type Limiter struct {
	mu    sync.RWMutex
	state *limiterState
}

type limiterState struct {
	limit   int
	slots   chan struct{}
	changed chan struct{}
}

func New(limit int) *Limiter {
	return &Limiter{state: newState(normalize(limit))}
}

func newState(limit int) *limiterState {
	return &limiterState{
		limit:   limit,
		slots:   make(chan struct{}, limit),
		changed: make(chan struct{}),
	}
}

func normalize(limit int) int {
	if limit < 1 {
		return 1
	}
	return limit
}

func (l *Limiter) Limit() int {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.state.limit
}

func (l *Limiter) SetLimit(limit int) {
	limit = normalize(limit)
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.state.limit == limit {
		return
	}
	close(l.state.changed)
	l.state = newState(limit)
}

// Acquire waits for a slot and returns a release function. A waiter is moved
// to the new limit when SetLimit is called while it is blocked.
func (l *Limiter) Acquire(ctx context.Context) (func(), error) {
	for {
		l.mu.RLock()
		state := l.state
		l.mu.RUnlock()

		select {
		case state.slots <- struct{}{}:
			l.mu.RLock()
			current := l.state
			l.mu.RUnlock()
			if current != state {
				<-state.slots
				continue
			}
			var once sync.Once
			return func() {
				once.Do(func() { <-state.slots })
			}, nil
		case <-state.changed:
			continue
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}
