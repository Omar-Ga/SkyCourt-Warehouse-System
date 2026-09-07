"""
Migration runner for SkyCourt Warehouse System.
Provides versioned, transactional migrations with checksum validation,
legacy baseline detection, and interruption recovery.
"""
import hashlib
import logging
import os
import re
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

CURRENT_SCHEMA_VERSION = 2

class MigrationError(Exception):
    """Base exception for migration errors."""
    pass

class IncompatibleSchemaError(MigrationError):
    """Raised when the database schema version is outdated or incompatible."""
    pass

class MigrationChecksumError(MigrationError):
    """Raised when an already applied migration has a modified checksum."""
    pass


def get_migrations_dir() -> Path:
    """Returns the absolute path to the migrations directory."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / "database" / "migrations"
    project_root = Path(__file__).resolve().parent.parent
    return project_root / "database" / "migrations"


def compute_checksum(content: str) -> str:
    """Calculates SHA-256 checksum of migration SQL content (normalized line endings)."""
    normalized = content.replace("\r\n", "\n").strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def split_sql_statements(sql: str) -> list[str]:
    """
    Splits an SQL script into executable individual statements.
    Removes full-line and inline comments while preserving semicolons inside statements.
    """
    statements = []
    current_statement = []
    
    for line in sql.splitlines():
        line_stripped = line.strip()
        if not line_stripped or line_stripped.startswith("--"):
            continue
        
        # Remove trailing comment if any
        if "--" in line:
            # Check if -- is not part of a string literal
            in_quote = False
            quote_char = None
            comment_start = -1
            for i, ch in enumerate(line):
                if ch in ("'", '"'):
                    if not in_quote:
                        in_quote = True
                        quote_char = ch
                    elif quote_char == ch:
                        in_quote = False
                elif ch == "-" and not in_quote and i + 1 < len(line) and line[i + 1] == "-":
                    comment_start = i
                    break
            if comment_start != -1:
                line = line[:comment_start]
        
        current_statement.append(line)
        if line.strip().endswith(";"):
            stmt = "\n".join(current_statement).strip()
            if stmt:
                statements.append(stmt)
            current_statement = []
            
    if current_statement:
        stmt = "\n".join(current_statement).strip()
        if stmt:
            statements.append(stmt)
            
    return statements


def init_migrations_table(conn):
    """Creates the schema_migrations table if it does not exist."""
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            checksum TEXT NOT NULL,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()


def get_applied_migrations(conn) -> dict[int, dict]:
    """Returns a dictionary of applied migrations keyed by version."""
    init_migrations_table(conn)
    cursor = conn.cursor()
    cursor.execute("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC")
    rows = cursor.fetchall()
    applied = {}
    for r in rows:
        version = r["version"] if hasattr(r, "__getitem__") and "version" in r else r[0]
        name = r["name"] if hasattr(r, "__getitem__") and "name" in r else r[1]
        checksum = r["checksum"] if hasattr(r, "__getitem__") and "checksum" in r else r[2]
        applied_at = r["applied_at"] if hasattr(r, "__getitem__") and "applied_at" in r else r[3]
        applied[version] = {
            "version": version,
            "name": name,
            "checksum": checksum,
            "applied_at": applied_at
        }
    return applied


def detect_legacy_baseline(conn) -> bool:
    """
    Detects if this is an unmigrated legacy database that has items/units/categories
    already created before schema_migrations existed.
    """
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='items'")
    has_items = cursor.fetchone() is not None
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='movement_logs'")
    has_logs = cursor.fetchone() is not None
    return bool(has_items and has_logs)


def get_available_migrations(migrations_dir: Path = None) -> list[tuple[int, str, Path]]:
    """
    Finds and parses all available migration files sorted by version.
    Returns list of (version, name, file_path).
    """
    if migrations_dir is None:
        migrations_dir = get_migrations_dir()
    
    if not migrations_dir.exists():
        return []
    
    migrations = []
    pattern = re.compile(r"^(\d+)_(.+)\.sql$")
    for file_path in migrations_dir.iterdir():
        if file_path.is_file() and file_path.suffix == ".sql":
            match = pattern.match(file_path.name)
            if match:
                version = int(match.group(1))
                name = file_path.name
                migrations.append((version, name, file_path))
    
    migrations.sort(key=lambda m: m[0])
    return migrations


def run_migrations(conn, migrations_dir: Path = None) -> list[int]:
    """
    Applies all pending migrations transactionally.
    Returns list of newly applied migration versions.
    """
    if migrations_dir is None:
        migrations_dir = get_migrations_dir()

    init_migrations_table(conn)
    applied = get_applied_migrations(conn)
    available = get_available_migrations(migrations_dir)
    
    # Check for legacy baseline: if no migrations recorded, but legacy tables exist
    if not applied and detect_legacy_baseline(conn):
        logger.info("Detected legacy database baseline. Baselining version 1.")
        # Find 001 migration if present
        v1_mig = next((m for m in available if m[0] == 1), None)
        if v1_mig:
            v1_content = v1_mig[2].read_text(encoding="utf-8")
            v1_checksum = compute_checksum(v1_content)
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)",
                (1, v1_mig[1], v1_checksum)
            )
            conn.commit()
            applied[1] = {"version": 1, "name": v1_mig[1], "checksum": v1_checksum}

    # Verify checksums of already-applied migrations
    for version, name, file_path in available:
        if version in applied:
            content = file_path.read_text(encoding="utf-8")
            checksum = compute_checksum(content)
            if applied[version]["checksum"] != checksum:
                raise MigrationChecksumError(
                    f"Checksum mismatch for migration {version} ({name}). "
                    f"Recorded: {applied[version]['checksum']}, Current: {checksum}"
                )

    newly_applied = []
    cursor = conn.cursor()
    
    for version, name, file_path in available:
        if version in applied:
            continue
        
        logger.info(f"Applying migration {version}: {name}")
        content = file_path.read_text(encoding="utf-8")
        checksum = compute_checksum(content)
        statements = split_sql_statements(content)
        
        try:
            # Transactional execution for this migration
            cursor.execute("BEGIN TRANSACTION")
            for stmt in statements:
                cursor.execute(stmt)
            
            cursor.execute(
                "INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)",
                (version, name, checksum)
            )
            cursor.execute("COMMIT")
            newly_applied.append(version)
            logger.info(f"Successfully applied migration {version}: {name}")
        except Exception as e:
            try:
                cursor.execute("ROLLBACK")
            except Exception:
                pass
            logger.error(f"Migration {version} failed: {e}. Transaction rolled back.")
            raise MigrationError(f"Migration {version} ({name}) failed: {e}") from e

    return newly_applied


def verify_schema_version(conn, required_version: int = CURRENT_SCHEMA_VERSION):
    """
    Verifies that the database schema is at or above the required version.
    Raises IncompatibleSchemaError if outdated or unmigrated.
    """
    init_migrations_table(conn)
    cursor = conn.cursor()
    cursor.execute("SELECT MAX(version) FROM schema_migrations")
    row = cursor.fetchone()
    current_version = 0
    if row:
        val = row["MAX(version)"] if hasattr(row, "__getitem__") and "MAX(version)" in row else row[0]
        if val is not None:
            current_version = int(val)
            
    if current_version < required_version:
        raise IncompatibleSchemaError(
            f"Database schema version is {current_version}, but version {required_version} is required. "
            f"Please run migrations before starting the application."
        )
    return current_version


if __name__ == "__main__":
    import argparse
    from app.models.db_utils import get_db

    parser = argparse.ArgumentParser(description="SkyCourt Warehouse Migration Runner")
    parser.add_argument("--check", action="store_true", help="Verify schema version without running migrations")
    args = parser.parse_args()

    conn = get_db()
    try:
        if args.check:
            ver = verify_schema_version(conn)
            print(f"Database schema is compatible at version {ver}.")
        else:
            applied = run_migrations(conn)
            if applied:
                print(f"Applied migrations: {applied}")
            else:
                print("Database is already up to date.")
            ver = verify_schema_version(conn)
            print(f"Current schema version: {ver}")
    finally:
        conn.close()

