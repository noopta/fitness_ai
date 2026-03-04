#!/usr/bin/env python3
"""
LiftOff RAG Ingestion Script
Usage:
    python3 scripts/ingestPDFs.py                     # ingest all PDFs
    python3 scripts/ingestPDFs.py --source NASM        # one source
    python3 scripts/ingestPDFs.py --dry-run            # preview chunks, no writes
    python3 scripts/ingestPDFs.py --source ACE --dry-run

Parses certification PDFs with PyMuPDF, chunks text, embeds with
OpenAI text-embedding-3-small, stores in SQLite KnowledgeChunk table.
Idempotent: existing chunks for a source are deleted before re-inserting.
"""

import os
import sys
import re
import json
import time
import sqlite3
import argparse
import textwrap
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
import urllib.request
import urllib.error

# ── Config ────────────────────────────────────────────────────────────────────

SCRIPT_DIR   = Path(__file__).parent
BACKEND_DIR  = SCRIPT_DIR.parent
PDF_DIR      = BACKEND_DIR.parent / "Certification_Textbooks"
DB_PATH      = BACKEND_DIR / "prisma" / "dev.db"
ENV_PATH     = BACKEND_DIR / ".env"

CHUNK_TARGET_CHARS  = 2400   # ≈ 600 tokens
CHUNK_OVERLAP_CHARS = 320    # ≈ 80 tokens
MIN_CHUNK_CHARS     = 200
EMBED_BATCH_SIZE    = 20     # chunks per OpenAI API call
EMBED_MODEL         = "text-embedding-3-small"

PDF_SOURCES = [
    {
        "file":   "NASM Essentials of Personal Fitness Training, 6th Edition -- Micheal Clark, Brian G. Sutton, Scott Lucett, National -- ( WeLib.org ).pdf",
        "source": "NASM",
    },
    {
        "file":   "a2ccc60ae9064b80daaa9ee86edc46f7_ACE Personal Trainer Manual Study Companion Fifth Edition -- American Council on Exercise; Project editor Daniel J Green -- ( WeLib.org ).pdf",
        "source": "ACE",
    },
    {
        "file":   "Advanced Concepts of Personal Training, 2nd Ed -- Arturo Leyva, PhD; Davy Levy, MS; Jennifer Maher, PhD; -- ( WeLib.org ).pdf",
        "source": "NCSF",
    },
    {
        "file":   "f9468a7174eadc1000de9b5c81d04864_NFPT Manual -- NFPT -- ( WeLib.org ).pdf",
        "source": "NFPT",
    },
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def load_api_key() -> str:
    """Read OPENAI_API_KEY from .env file."""
    if not ENV_PATH.exists():
        raise FileNotFoundError(f".env not found at {ENV_PATH}")
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith("OPENAI_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"').strip("'")
            if key:
                return key
    raise ValueError("OPENAI_API_KEY not found in .env")


def clean_text(raw: str) -> str:
    """Clean extracted PDF text: remove artifacts, normalise whitespace."""
    text = raw
    # Normalise line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Remove form feeds
    text = text.replace("\f", "\n\n")
    # Fix hyphenated line-breaks: word-\ncontinued → wordcontinued
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    # Remove lines that are just page numbers (1–4 digits alone on a line)
    text = re.sub(r"^\s*\d{1,4}\s*$", "", text, flags=re.MULTILINE)
    # Collapse 3+ blank lines to two
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Remove lines that are all-caps and very short (likely headers/footers)
    lines = []
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped and stripped.isupper() and len(stripped) < 60 and len(stripped.split()) <= 6:
            continue
        lines.append(line)
    text = "\n".join(lines)
    # Collapse multiple spaces/tabs
    text = re.sub(r"[ \t]{2,}", " ", text)
    # Trim each line
    text = "\n".join(l.strip() for l in text.split("\n"))
    return text.strip()


def extract_heading(text: str) -> Optional[str]:
    """Return a best-guess section heading from the start of a chunk."""
    for line in text.split("\n")[:6]:
        t = line.strip()
        if 3 <= len(t) <= 80 and not t.endswith(".") and t[0].isupper():
            # Avoid numeric-only or single-word noise
            if len(t.split()) >= 2 or (len(t.split()) == 1 and len(t) > 5):
                return t
    return None


def split_into_chunks(text: str) -> list[str]:
    """Paragraph-aware chunking with overlap."""
    paragraphs = re.split(r"\n\n+", text)
    chunks: list[str] = []
    current = ""
    overlap = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        candidate = (current + "\n\n" + para).strip() if current else para
        if len(candidate) > CHUNK_TARGET_CHARS and current:
            chunks.append(current.strip())
            # Build overlap from tail of current chunk
            tail = current[-CHUNK_OVERLAP_CHARS:]
            idx = tail.find(" ")
            overlap = tail[idx + 1:] if idx >= 0 else tail
            current = (overlap + "\n\n" + para).strip()
        else:
            current = candidate

    if current.strip() and len(current.strip()) >= MIN_CHUNK_CHARS:
        chunks.append(current.strip())

    return [c for c in chunks if len(c) >= MIN_CHUNK_CHARS]


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def embed_batch(texts: list[str], api_key: str) -> list[list[float]]:
    """Call OpenAI embeddings endpoint, return list of float vectors."""
    payload = json.dumps({
        "model": EMBED_MODEL,
        "input": texts,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.openai.com/v1/embeddings",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI API error {e.code}: {body}") from e

    # Sort by index to maintain order
    return [item["embedding"] for item in sorted(data["data"], key=lambda x: x["index"])]


# ── DB helpers ────────────────────────────────────────────────────────────────

def db_connect() -> sqlite3.Connection:
    return sqlite3.connect(str(DB_PATH))


def db_delete_source(conn: sqlite3.Connection, source: str) -> int:
    cur = conn.execute("DELETE FROM KnowledgeChunk WHERE source = ?", (source,))
    conn.commit()
    return cur.rowcount


def db_insert_chunk(
    conn: sqlite3.Connection,
    source: str,
    chapter: Optional[str],
    content: str,
    embedding: list[float],
    token_count: int,
) -> None:
    import uuid
    conn.execute(
        "INSERT INTO KnowledgeChunk (id, source, chapter, content, embedding, tokenCount, createdAt) "
        "VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
        (str(uuid.uuid4()), source, chapter, content, json.dumps(embedding), token_count),
    )


def db_count(conn: sqlite3.Connection, source: Optional[str] = None) -> int:
    if source:
        return conn.execute("SELECT COUNT(*) FROM KnowledgeChunk WHERE source = ?", (source,)).fetchone()[0]
    return conn.execute("SELECT COUNT(*) FROM KnowledgeChunk").fetchone()[0]


# ── Core ingestion ────────────────────────────────────────────────────────────

def ingest_source(source_cfg: dict, api_key: str, dry_run: bool) -> None:
    source = source_cfg["source"]
    pdf_path = PDF_DIR / source_cfg["file"]

    print(f"\n{'=' * 60}")
    print(f"SOURCE: {source}")
    print(f"FILE:   {pdf_path.name}")
    print(f"{'=' * 60}")

    if not pdf_path.exists():
        print(f"  ✗ File not found: {pdf_path}")
        return

    # ── Extract text with PyMuPDF ──────────────────────────────────────
    print("  Extracting text with PyMuPDF...")
    doc = fitz.open(str(pdf_path))
    pages_text: list[str] = []
    for page in doc:
        pages_text.append(page.get_text("text"))  # type: ignore[attr-defined]
    doc.close()
    raw = "\n\n".join(pages_text)
    print(f"  Pages: {len(pages_text)}  Raw chars: {len(raw):,}")

    # ── Clean ─────────────────────────────────────────────────────────
    cleaned = clean_text(raw)
    print(f"  Cleaned chars: {len(cleaned):,}")

    # ── Chunk ─────────────────────────────────────────────────────────
    chunks = split_into_chunks(cleaned)
    avg_len = sum(len(c) for c in chunks) // max(len(chunks), 1)
    print(f"  Chunks: {len(chunks)}  (avg {avg_len} chars / ~{avg_len // 4} tokens)")

    if dry_run:
        print("\n  [DRY RUN] First 3 chunks:\n")
        for i, chunk in enumerate(chunks[:3]):
            print(f"  --- Chunk {i + 1} ({len(chunk)} chars) ---")
            preview = textwrap.indent(chunk[:400], "  ")
            print(preview)
            print()
        return

    # ── Store ─────────────────────────────────────────────────────────
    conn = db_connect()
    existing = db_count(conn, source)
    if existing > 0:
        deleted = db_delete_source(conn, source)
        print(f"  Deleted {deleted} existing chunks for {source}")

    stored = 0
    skipped = 0
    total = len(chunks)
    total_batches = (total + EMBED_BATCH_SIZE - 1) // EMBED_BATCH_SIZE

    for batch_idx in range(0, total, EMBED_BATCH_SIZE):
        batch = chunks[batch_idx: batch_idx + EMBED_BATCH_SIZE]
        batch_num = batch_idx // EMBED_BATCH_SIZE + 1
        print(f"  Embedding batch {batch_num}/{total_batches}...", end="", flush=True)

        try:
            embeddings = embed_batch(batch, api_key)
            for j, (content, embedding) in enumerate(zip(batch, embeddings)):
                chapter = extract_heading(content)
                token_count = estimate_tokens(content)
                db_insert_chunk(conn, source, chapter, content, embedding, token_count)
                stored += 1
            conn.commit()
            print(f" ✓ ({stored}/{total})")
        except Exception as e:
            print(f" ✗ ERROR: {e}")
            skipped += len(batch)

        # Brief pause between batches
        if batch_idx + EMBED_BATCH_SIZE < total:
            time.sleep(0.15)

    conn.close()
    print(f"  ✅ {source} complete: {stored} stored, {skipped} skipped")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="LiftOff RAG ingestion")
    parser.add_argument("--source", help="Ingest only this source (NASM|ACE|NCSF|NFPT)")
    parser.add_argument("--dry-run", action="store_true", help="Preview chunks, no DB writes")
    args = parser.parse_args()

    print("\n🔬 LiftOff RAG Ingestion")
    print(f"Mode: {'DRY RUN (no writes)' if args.dry_run else 'LIVE'}")

    sources = PDF_SOURCES
    if args.source:
        sources = [s for s in PDF_SOURCES if s["source"] == args.source]
        if not sources:
            print(f"Unknown source: {args.source}. Options: {[s['source'] for s in PDF_SOURCES]}")
            sys.exit(1)
        print(f"Filter: {args.source} only")

    api_key = "" if args.dry_run else load_api_key()

    start = time.time()
    for source_cfg in sources:
        ingest_source(source_cfg, api_key, args.dry_run)

    elapsed = time.time() - start

    if not args.dry_run:
        conn = db_connect()
        total = db_count(conn)
        rows = conn.execute(
            "SELECT source, COUNT(*) as cnt FROM KnowledgeChunk GROUP BY source ORDER BY source"
        ).fetchall()
        conn.close()
        print("\n📊 Final DB state:")
        for source, cnt in rows:
            print(f"   {source}: {cnt} chunks")
        print(f"   Total: {total} chunks")

    print(f"\n⏱  Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
