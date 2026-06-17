package models

// ── Group ────────────────────────────────────────────────────────────────

type GroupCreate struct {
	Name string `json:"name"`
}

type GroupUpdate struct {
	Name                *string `json:"name,omitempty"`
	CoverIllustrationID *int    `json:"cover_illustration_id,omitempty"`
}

type GroupResponse struct {
	ID                  int     `json:"id"`
	Name                string  `json:"name"`
	CoverIllustrationID *int    `json:"cover_illustration_id"`
	CoverThumbnailURL   *string `json:"cover_thumbnail_url"`
	IllustrationCount   int     `json:"illustration_count"`
	CreatedAt           string  `json:"created_at"`
}

// ── Illustration ─────────────────────────────────────────────────────────

type IllustrationResponse struct {
	ID               int         `json:"id"`
	GroupID          int         `json:"group_id"`
	GroupName        string      `json:"group_name"`
	Filename         string      `json:"filename"`
	OriginalFilename string      `json:"original_filename"`
	FileSize         int64       `json:"file_size"`
	Width            *int        `json:"width"`
	Height           *int        `json:"height"`
	MimeType         string      `json:"mime_type"`
	Tags             string      `json:"tags"`
	ExtendedData     interface{} `json:"extended_data"`
	ThumbnailURL     string      `json:"thumbnail_url"`
	FileURL          string      `json:"file_url"`
	CreatedAt        string      `json:"created_at"`
}

type IllustrationUpdate struct {
	Tags *string `json:"tags,omitempty"`
}

type IllustrationListResult struct {
	Items  []IllustrationResponse `json:"items"`
	Total  int                    `json:"total"`
	Offset int                    `json:"offset"`
	Limit  int                    `json:"limit"`
}

// ── Search ───────────────────────────────────────────────────────────────

type SearchResult struct {
	Items  []IllustrationResponse `json:"items"`
	Total  int                    `json:"total"`
	Offset int                    `json:"offset"`
	Limit  int                    `json:"limit"`
}

// ── Error ────────────────────────────────────────────────────────────────

type ErrorResponse struct {
	Detail string `json:"detail"`
}

// ── Model ────────────────────────────────────────────────────────────────

type ModelInfo struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Cached *bool  `json:"cached,omitempty"`
	Size   *int64 `json:"size,omitempty"`
}

type ModelListResponse struct {
	Models      []ModelInfo `json:"models"`
	ActiveModel string      `json:"active_model"`
}

type ModelStatusResponse struct {
	Cached bool `json:"cached"`
}

type ModelUploadResponse struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Size int64  `json:"size"`
}

// ── Settings ─────────────────────────────────────────────────────────────

type Settings struct {
	AutoTag     bool   `json:"auto_tag"`
	GPUEnabled  bool   `json:"gpu_enabled"`
	ActiveModel string `json:"active_model,omitempty"`
}
