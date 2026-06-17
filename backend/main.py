import os
import sys as _sys
import json
import shutil
from contextlib import asynccontextmanager
from io import BytesIO
from typing import Optional, AsyncGenerator

from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

from database import get_db, init_db
from models import (
    GroupCreate, GroupUpdate, GroupResponse,
    IllustrationResponse, IllustrationUpdate,
    SearchResult, IllustrationListResult,
)
from utils import extract_metadata, extract_tags, create_thumbnail, get_image_info, set_use_gpu, is_model_cached, download_model, list_available_models, set_active_model, get_active_model, USER_MODEL_DIR

BASE_DIR:str = os.path.dirname(os.path.abspath(__file__))
if getattr(_sys, "frozen", False):
    BASE_DIR = os.path.dirname(_sys.executable)
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
SETTINGS_PATH = os.path.join(BASE_DIR, "settings.json")


def load_settings():
    try:
        with open(SETTINGS_PATH, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"auto_tag": True, "gpu_enabled": False}


def save_settings(data):
    with open(SETTINGS_PATH, "w") as f:
        json.dump(data, f, indent=2)


# Apply GPU and model settings on startup
_settings = load_settings()
set_use_gpu(_settings.get("gpu_enabled", False))
if _settings.get("active_model"):
    set_active_model(_settings["active_model"])

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    init_db()
    yield


app = FastAPI(title="Gallery API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── helpers ─────────────────────────────────────────────

THUMBNAIL_QUALITY_CONFIG = {
    "low": {"max_size": 400, "jpeg_quality": 75, "dir": "thumbnails"},
    "normal": {"max_size": 1200, "jpeg_quality": 85, "dir": "thumbnails_normal"},
}


def _group_upload_dir(group_id: int) -> str:
    p = os.path.join(UPLOADS_DIR, str(group_id))
    os.makedirs(os.path.join(p, "originals"), exist_ok=True)
    os.makedirs(os.path.join(p, "thumbnails"), exist_ok=True)
    os.makedirs(os.path.join(p, "thumbnails_normal"), exist_ok=True)
    return p


def _build_cover_url(cover_id: Optional[int]) -> Optional[str]:
    if cover_id is None:
        return None
    return f"/api/illustrations/{cover_id}/thumbnail"


def _row_to_group(row) -> GroupResponse:
    return GroupResponse(
        id=row["id"],
        name=row["name"],
        cover_illustration_id=row["cover_illustration_id"],
        cover_thumbnail_url=_build_cover_url(row["cover_illustration_id"]),
        illustration_count=row["illustration_count"],
        created_at=row["created_at"],
    )


def _row_to_illustration(row) -> IllustrationResponse:
    iid = row["id"]
    gid = row["group_id"]
    return IllustrationResponse(
        id=iid,
        group_id=gid,
        group_name=row["group_name"],
        filename=row["filename"],
        original_filename=row["original_filename"],
        file_size=row["file_size"],
        width=row["width"],
        height=row["height"],
        mime_type=row["mime_type"],
        tags=row["tags"],
        extended_data=json.loads(row["extended_data"]) if row["extended_data"] else None,
        thumbnail_url=f"/api/illustrations/{iid}/thumbnail",
        file_url=f"/api/illustrations/{iid}/file",
        created_at=row["created_at"],
    )


# ── Group routes ───────────────────────────────────────

@app.get("/api/groups", response_model=list[GroupResponse])
def list_groups():
    conn = get_db()
    rows = conn.execute("""
        SELECT g.*, COUNT(i.id) AS illustration_count
        FROM groups g
        LEFT JOIN illustrations i ON g.id = i.group_id
        GROUP BY g.id
        ORDER BY g.created_at DESC
    """).fetchall()
    conn.close()
    return [_row_to_group(r) for r in rows]


@app.post("/api/groups", response_model=GroupResponse, status_code=201)
def create_group(body: GroupCreate):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO groups (name) VALUES (?)",
        (body.name,),
    )
    conn.commit()
    group_id = cur.lastrowid
    row = conn.execute("SELECT * FROM groups WHERE id = ?", (group_id,)).fetchone()
    conn.close()
    return GroupResponse(
        id=row["id"],
        name=row["name"],
        cover_illustration_id=None,
        cover_thumbnail_url=None,
        illustration_count=0,
        created_at=row["created_at"],
    )


@app.get("/api/groups/{group_id}", response_model=GroupResponse)
def get_group(group_id: int):
    conn = get_db()
    row = conn.execute("""
        SELECT g.*, COUNT(i.id) AS illustration_count
        FROM groups g
        LEFT JOIN illustrations i ON g.id = i.group_id
        WHERE g.id = ?
        GROUP BY g.id
    """, (group_id,)).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(404, "Group not found")
    return _row_to_group(row)


@app.put("/api/groups/{group_id}", response_model=GroupResponse)
def update_group(group_id: int, body: GroupUpdate):
    conn = get_db()
    group = conn.execute("SELECT * FROM groups WHERE id = ?", (group_id,)).fetchone()
    if group is None:
        conn.close()
        raise HTTPException(404, "Group not found")

    if body.name is not None:
        conn.execute("UPDATE groups SET name = ? WHERE id = ?", (body.name, group_id))

    if body.cover_illustration_id is not None:
        ill = conn.execute(
            "SELECT id FROM illustrations WHERE id = ? AND group_id = ?",
            (body.cover_illustration_id, group_id),
        ).fetchone()
        if ill is None:
            conn.close()
            raise HTTPException(400, "Cover illustration must belong to this group")
        conn.execute(
            "UPDATE groups SET cover_illustration_id = ? WHERE id = ?",
            (body.cover_illustration_id, group_id),
        )

    conn.commit()
    row = conn.execute("""
        SELECT g.*, COUNT(i.id) AS illustration_count
        FROM groups g
        LEFT JOIN illustrations i ON g.id = i.group_id
        WHERE g.id = ?
        GROUP BY g.id
    """, (group_id,)).fetchone()
    conn.close()
    return _row_to_group(row)


@app.delete("/api/groups/{group_id}", status_code=204)
def delete_group(group_id: int):
    conn = get_db()
    group = conn.execute("SELECT id FROM groups WHERE id = ?", (group_id,)).fetchone()
    if group is None:
        conn.close()
        raise HTTPException(404, "Group not found")

    # Unset cover reference to avoid FK issues, then delete illustrations
    conn.execute("UPDATE groups SET cover_illustration_id = NULL WHERE id = ?", (group_id,))
    conn.execute("DELETE FROM illustrations WHERE group_id = ?", (group_id,))
    conn.execute("DELETE FROM groups WHERE id = ?", (group_id,))
    conn.commit()
    conn.close()

    # Remove uploaded files
    group_dir = os.path.join(UPLOADS_DIR, str(group_id))
    if os.path.isdir(group_dir):
        shutil.rmtree(group_dir)


# ── Illustration routes ─────────────────────────────────

@app.get("/api/groups/{group_id}/illustrations", response_model=IllustrationListResult)
def list_illustrations(
    group_id: int,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100000),
):
    conn = get_db()
    group = conn.execute("SELECT id, name FROM groups WHERE id = ?", (group_id,)).fetchone()
    if group is None:
        conn.close()
        raise HTTPException(404, "Group not found")

    total = conn.execute(
        "SELECT COUNT(*) AS cnt FROM illustrations WHERE group_id = ?",
        (group_id,),
    ).fetchone()["cnt"]

    rows = conn.execute("""
        SELECT i.*, ? AS group_name
        FROM illustrations i
        WHERE i.group_id = ?
        ORDER BY i.created_at DESC
        LIMIT ? OFFSET ?
    """, (group["name"], group_id, limit, offset)).fetchall()
    conn.close()

    return {
        "items": [_row_to_illustration(r) for r in rows],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@app.post("/api/groups/{group_id}/illustrations/upload", response_model=list[IllustrationResponse], status_code=201)
def upload_illustrations(
    group_id: int,
    files: list[UploadFile] = File(...),
    skip_auto_tag: bool = Form(False),
):
    conn = get_db()
    group = conn.execute("SELECT id, name FROM groups WHERE id = ?", (group_id,)).fetchone()
    if group is None:
        conn.close()
        raise HTTPException(404, "Group not found")
    conn.close()

    _group_upload_dir(group_id)
    results: list[IllustrationResponse] = []

    for upload in files:
        if upload.filename is None:
            continue
        safe_filename = os.path.basename(upload.filename)

        try:
            contents = upload.file.read()
            image = Image.open(BytesIO(contents))
            image.load()
        except UnidentifiedImageError:
            raise HTTPException(400, f"Cannot identify image: {safe_filename}")
        except Exception:
            raise HTTPException(400, f"Failed to read image: {safe_filename}")

        try:
            if not skip_auto_tag and load_settings().get("auto_tag", True):
                tags = extract_tags(image)
            else:
                tags = ""
            width, height, mime_type = get_image_info(image)

            conn = get_db()
            cur = conn.execute(
                """INSERT INTO illustrations
                   (group_id, filename, original_filename, file_size, width, height,
                    mime_type, tags, extended_data)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    group_id,
                    "",  # placeholder, set after we know the id
                    safe_filename,
                    len(contents),
                    width,
                    height,
                    mime_type,
                    tags,
                    None,  # extended_data will be updated after files are written to disk
                ),
            )
            ill_id = cur.lastrowid
            disk_filename = f"{ill_id}_{safe_filename}"

            # Write files to disk (needed for metadata extraction)
            originals_dir = os.path.join(UPLOADS_DIR, str(group_id), "originals")

            # Generate thumbnails at both quality levels
            for quality, cfg in THUMBNAIL_QUALITY_CONFIG.items():
                thumb = create_thumbnail(image, max_size=cfg["max_size"])
                thumb_dir = os.path.join(UPLOADS_DIR, str(group_id), cfg["dir"])
                thumb.save(os.path.join(thumb_dir, disk_filename), format="JPEG",
                           quality=cfg["jpeg_quality"])

            image.save(os.path.join(originals_dir, disk_filename))

            # Extract ComfyUI metadata from saved file
            saved_path = os.path.join(originals_dir, disk_filename)
            try:
                metadata = extract_metadata(saved_path, image)
                extended_data_json = json.dumps(metadata, ensure_ascii=False)
            except Exception:
                extended_data_json = None

            conn.execute(
                "UPDATE illustrations SET filename = ?, extended_data = ? WHERE id = ?",
                (disk_filename, extended_data_json, ill_id),
            )
            conn.commit()

            row = conn.execute(
                "SELECT i.*, ? AS group_name FROM illustrations i WHERE i.id = ?",
                (group["name"], ill_id),
            ).fetchone()
            conn.close()

            results.append(_row_to_illustration(row))

        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(500, f"Failed to process {safe_filename}: {exc}")

    return results


@app.get("/api/illustrations/{illustration_id}", response_model=IllustrationResponse)
def get_illustration(illustration_id: int):
    conn = get_db()
    row = conn.execute("""
        SELECT i.*, g.name AS group_name
        FROM illustrations i
        JOIN groups g ON i.group_id = g.id
        WHERE i.id = ?
    """, (illustration_id,)).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(404, "Illustration not found")
    return _row_to_illustration(row)


@app.get("/api/illustrations/{illustration_id}/file")
def serve_illustration_file(illustration_id: int, download: bool = Query(False)):
    conn = get_db()
    row = conn.execute(
        "SELECT filename, group_id, mime_type, original_filename FROM illustrations WHERE id = ?",
        (illustration_id,),
    ).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(404, "Illustration not found")

    filepath = os.path.join(UPLOADS_DIR, str(row["group_id"]), "originals", row["filename"])
    if not os.path.isfile(filepath):
        raise HTTPException(404, "File not found on disk")

    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{row["original_filename"]}"'
    return FileResponse(filepath, media_type=row["mime_type"], headers=headers if headers else None)


@app.get("/api/illustrations/{illustration_id}/thumbnail")
def serve_illustration_thumbnail(illustration_id: int, quality: str = "low"):
    if quality not in ("low", "normal", "original"):
        raise HTTPException(400, "quality must be one of: low, normal, original")

    conn = get_db()
    row = conn.execute(
        "SELECT filename, group_id, mime_type FROM illustrations WHERE id = ?",
        (illustration_id,),
    ).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(404, "Illustration not found")

    group_dir = os.path.join(UPLOADS_DIR, str(row["group_id"]))
    filename = row["filename"]

    # Original quality — serve the original file directly
    if quality == "original":
        filepath = os.path.join(group_dir, "originals", filename)
        if not os.path.isfile(filepath):
            raise HTTPException(404, "Original file not found on disk")
        return FileResponse(filepath, media_type=row["mime_type"])

    cfg = THUMBNAIL_QUALITY_CONFIG[quality]
    thumb_dir = os.path.join(group_dir, cfg["dir"])
    filepath = os.path.join(thumb_dir, filename)

    # Generate on-the-fly for pre-existing illustrations without this quality level
    if not os.path.isfile(filepath):
        original_path = os.path.join(group_dir, "originals", filename)
        if not os.path.isfile(original_path):
            raise HTTPException(404, "Original file not found — cannot generate thumbnail")
        try:
            from PIL import Image
            img = Image.open(original_path)
            img.load()
            thumb = create_thumbnail(img, max_size=cfg["max_size"])
            thumb.save(filepath, format="JPEG", quality=cfg["jpeg_quality"])
        except Exception:
            raise HTTPException(500, "Failed to generate thumbnail on-the-fly")

    return FileResponse(filepath, media_type="image/jpeg")


@app.delete("/api/illustrations/{illustration_id}", status_code=204)
def delete_illustration(illustration_id: int):
    conn = get_db()
    row = conn.execute("SELECT id, filename, group_id FROM illustrations WHERE id = ?", (illustration_id,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(404, "Illustration not found")

    # Unset as cover if it is one
    conn.execute(
        "UPDATE groups SET cover_illustration_id = NULL WHERE cover_illustration_id = ?",
        (illustration_id,),
    )
    conn.execute("DELETE FROM illustrations WHERE id = ?", (illustration_id,))
    conn.commit()
    conn.close()

    # Delete files
    group_dir = os.path.join(UPLOADS_DIR, str(row["group_id"]))
    for sub in ("originals", "thumbnails", "thumbnails_normal"):
        fp = os.path.join(group_dir, sub, row["filename"])
        if os.path.isfile(fp):
            os.remove(fp)


@app.put("/api/illustrations/{illustration_id}", response_model=IllustrationResponse)
def update_illustration(illustration_id: int, body: IllustrationUpdate):
    conn = get_db()
    row = conn.execute(
        "SELECT i.*, g.name AS group_name FROM illustrations i JOIN groups g ON i.group_id = g.id WHERE i.id = ?",
        (illustration_id,),
    ).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(404, "Illustration not found")

    if body.tags is not None:
        conn.execute(
            "UPDATE illustrations SET tags = ? WHERE id = ?",
            (body.tags, illustration_id),
        )
        conn.commit()

    row = conn.execute(
        "SELECT i.*, g.name AS group_name FROM illustrations i JOIN groups g ON i.group_id = g.id WHERE i.id = ?",
        (illustration_id,),
    ).fetchone()
    conn.close()
    return _row_to_illustration(row)


@app.get("/api/illustrations/{illustration_id}/metadata")
def get_illustration_metadata(illustration_id: int):
    conn = get_db()
    row = conn.execute(
        "SELECT extended_data FROM illustrations WHERE id = ?",
        (illustration_id,),
    ).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(404, "Illustration not found")
    if row["extended_data"]:
        return json.loads(row["extended_data"])
    return {}


# ── Search ──────────────────────────────────────────────

@app.get("/api/search", response_model=SearchResult)
def search_illustrations(
    q: str = Query(..., min_length=1, description="Search query for tags"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    # Build FTS5 prefix query: wrap each term for prefix matching
    terms = [t.strip() for t in q.replace(",", " ").split() if t.strip()]
    if not terms:
        return SearchResult(items=[], total=0, offset=offset, limit=limit)

    # Escape double-quotes inside terms and build prefix terms
    safe_terms = []
    for t in terms:
        clean = t.replace('"', '')
        safe_terms.append(f'"{clean}"*')
    fts_query = " AND ".join(safe_terms)

    conn = get_db()
    try:
        count_row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM illustrations_fts WHERE illustrations_fts MATCH ?",
            (fts_query,),
        ).fetchone()
        total = count_row["cnt"]

        rows = conn.execute("""
            SELECT i.*, g.name AS group_name
            FROM illustrations_fts fts
            JOIN illustrations i ON fts.rowid = i.id
            JOIN groups g ON i.group_id = g.id
            WHERE illustrations_fts MATCH ?
            ORDER BY rank
            LIMIT ? OFFSET ?
        """, (fts_query, limit, offset)).fetchall()
    except Exception:
        conn.close()
        return SearchResult(items=[], total=0, offset=offset, limit=limit)

    conn.close()
    items = [_row_to_illustration(r) for r in rows]
    return SearchResult(items=items, total=total, offset=offset, limit=limit)


# ── Tags & Prompts ──────────────────────────────────────

@app.get("/api/tags")
def list_tags():
    conn = get_db()
    rows = conn.execute(
        "SELECT tags FROM illustrations WHERE tags IS NOT NULL AND tags != ''"
    ).fetchall()
    conn.close()

    unique = set()
    for r in rows:
        for t in r["tags"].split(","):
            trimmed = t.strip()
            if trimmed:
                unique.add(trimmed)
    return sorted(unique)


@app.get("/api/prompts")
def list_prompts():
    conn = get_db()
    rows = conn.execute(
        "SELECT extended_data FROM illustrations WHERE extended_data IS NOT NULL"
    ).fetchall()
    conn.close()

    unique = set()
    for r in rows:
        try:
            data = json.loads(r["extended_data"])
        except (json.JSONDecodeError, TypeError):
            continue
        for key in ("Positive Prompt", "Negative Prompt"):
            text = data.get(key, "")
            if text:
                for term in text.split(","):
                    trimmed = term.strip()
                    if trimmed:
                        unique.add(trimmed)
    return sorted(unique)


# ── Model ───────────────────────────────────────────────

@app.get("/api/model/status")
def model_status():
    """Return whether the tagger model is already cached locally."""
    return {"cached": is_model_cached()}


@app.post("/api/model/download", status_code=200)
def model_download():
    """Pre-download the tagger model. Blocking — may take a while on first call."""
    try:
        download_model()
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(500, f"Model download failed: {exc}")


# ── Settings ────────────────────────────────────────────

@app.get("/api/settings")
def get_settings():
    return load_settings()


@app.put("/api/settings")
def update_settings(body: dict):
    current = load_settings()
    allowed = {"auto_tag", "gpu_enabled", "active_model"}
    for key in body:
        if key in allowed:
            if key == "active_model":
                current[key] = str(body[key]) if body[key] else ""
            else:
                current[key] = bool(body[key])
    save_settings(current)
    # Apply settings immediately
    set_use_gpu(current.get("gpu_enabled", False))
    set_active_model(current.get("active_model", ""))
    return current


# ── Model management ─────────────────────────────────────

@app.get("/api/models")
def list_models():
    """List default model + user-uploaded models."""
    models = list_available_models()
    current = get_active_model()
    return {"models": models, "active_model": current}


@app.post("/api/models/upload", status_code=201)
async def upload_model(file: UploadFile = File(...)):
    """Upload a model file (.onnx or .csv) to the user_model directory."""
    if not file.filename:
        raise HTTPException(400, "No file provided")
    safe_name = os.path.basename(file.filename)
    if not safe_name:
        raise HTTPException(400, "Invalid filename")
    ext = os.path.splitext(safe_name)[1].lower()
    if ext not in (".onnx", ".csv"):
        raise HTTPException(400, "Only .onnx and .csv files are accepted")
    dest = os.path.join(USER_MODEL_DIR, safe_name)
    if os.path.exists(dest):
        raise HTTPException(409, f"File '{safe_name}' already exists")
    contents = await file.read()
    with open(dest, "wb") as f:
        f.write(contents)
    return {"name": safe_name, "type": "user", "size": os.path.getsize(dest)}


@app.delete("/api/models/{model_name:path}")
def delete_model(model_name: str):
    """Delete a user-uploaded model file from user_model/."""
    safe_name = os.path.basename(model_name)
    if not safe_name:
        raise HTTPException(400, "Invalid model name")
    target = os.path.join(USER_MODEL_DIR, safe_name)
    if not os.path.exists(target):
        raise HTTPException(404, "Model not found")
    if not os.path.realpath(target).startswith(os.path.realpath(USER_MODEL_DIR)):
        raise HTTPException(400, "Path traversal denied")
    try:
        os.remove(target)
    except Exception as exc:
        raise HTTPException(500, f"Failed to delete: {exc}")
    # If the deleted model was active, reset to default
    if get_active_model() == safe_name:
        set_active_model("")
        current = load_settings()
        current["active_model"] = ""
        save_settings(current)
    return {"status": "deleted"}


# ── Frontend static files (catch-all must be last) ────────

if getattr(_sys, "frozen", False):
    # PyInstaller onedir: frontend bundled in _internal/frontend
    _exe_dir = os.path.dirname(_sys.executable)
    FRONTEND_BUILD = os.path.join(_exe_dir, "_internal", "frontend")
else:
    FRONTEND_BUILD = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend", "build"))

if os.path.isdir(FRONTEND_BUILD):
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = os.path.join(FRONTEND_BUILD, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_BUILD, "index.html"))


if __name__ == "__main__":
    import sys
    import uvicorn

    if getattr(sys, "frozen", False):
        uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)
    else:
        uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)

#package: pyinstaller --clean backend.spec
