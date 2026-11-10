package groupconfig

import (
	"errors"
	"path/filepath"
	"testing"

	"artifex-backend/internal/database"
)

func TestGalleryPreferencesPreserveExistingView(t *testing.T) {
	ctx := t.Context()
	db, err := database.Open(filepath.Join(t.TempDir(), "gallery.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if _, err := db.ExecContext(ctx, "INSERT INTO groups (id, name) VALUES (1, 'Studies')"); err != nil {
		t.Fatal(err)
	}
	legacy := `{"sort_by":"resolution","sort_order":"asc","quality":"normal","card_size":2,"original_ratio":true,"group_by":"mixed","page_size":"all"}`
	if _, err := db.ExecContext(ctx, "INSERT INTO group_configs (group_id, view, colors) VALUES (1, ?, ?)", legacy, string(EmptyColors())); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	view := cfg.Groups["1"].View
	if view.SortBy != "resolution" || view.ColorGroupLayout != "single" ||
		view.ColorGroupPreviewMode != "all" || view.ColorGroupPreviewLimit != 4 {
		t.Fatalf("unexpected view loaded from legacy row: %+v", view)
	}

	patch := `{"groups":{"1":{"view":{"color_group_layout":"mixed","color_group_preview_mode":"limited","color_group_preview_limit":7}}}}`
	if _, err := Update(ctx, db, []byte(patch)); err != nil {
		t.Fatal(err)
	}
	invalid := `{"groups":{"1":{"view":{"color_group_preview_limit":0}}}}`
	if _, err := Update(ctx, db, []byte(invalid)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected invalid limit to be rejected, got %v", err)
	}

	cfg, err = Load(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	view.ColorGroupLayout = "mixed"
	view.ColorGroupPreviewMode = "limited"
	view.ColorGroupPreviewLimit = 7
	if got := cfg.Groups["1"].View; got != view {
		t.Fatalf("stored view changed outside the patch: got %+v, want %+v", got, view)
	}
}
