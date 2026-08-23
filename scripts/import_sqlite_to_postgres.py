#!/usr/bin/env python3
"""把本机 SQLite（wrong_questions.db）导入到当前 DATABASE_URL 指向的 PostgreSQL。

仅在目标库为空时默认执行；已有业务数据时需要 --force。
遗留表 vocabulary_words / question_claim_requests 不在当前模型中，会跳过。
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

from sqlalchemy import MetaData, Table, create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import settings  # noqa: E402

TABLE_ORDER = [
    "users",
    "question_types",
    "knowledge_tags",
    "wrong_questions",
    "wrong_question_knowledge_tags",
    "practice_records",
    "assignments",
    "assignment_questions",
    "user_assignments",
    "user_answers",
    "learning_weakness_analyses",
    "knowledge_lesson_analyses",
    "bank_access_requests",
    "activity_logs",
]

JSON_COLUMNS = {
    "wrong_questions": {"options", "correct_answer", "wrong_answer", "ocr_payload", "ai_analysis"},
    "practice_records": {"generated_question"},
    "assignment_questions": {"snapshot"},
    "user_answers": {"user_answer", "standard_answer"},
    "learning_weakness_analyses": {"source_items", "result"},
    "knowledge_lesson_analyses": {"result"},
    "activity_logs": {"extra"},
}

BOOL_COLUMNS = {
    "wrong_questions": {"deleted"},
    "practice_records": {"is_correct"},
    "users": {"is_active"},
    "user_answers": {"is_correct"},
}

SKIP_SQLITE_TABLES = {"vocabulary_words", "question_claim_requests"}


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="导入 SQLite 数据到 PostgreSQL")
    parser.add_argument(
        "--sqlite",
        default=str(ROOT / "wrong_questions.db"),
        help="SQLite 文件路径",
    )
    parser.add_argument("--force", action="store_true", help="目标库已有数据时仍覆盖导入")
    return parser.parse_args()


def _coerce_json(value):
    if value is None or value == "":
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode()
    if isinstance(value, str):
        return json.loads(value)
    return value


def _coerce_bool(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "t", "yes"}
    return bool(value)


def _row_to_dict(table: str, row: sqlite3.Row, dest_columns: set[str]) -> dict:
    data = {}
    json_cols = JSON_COLUMNS.get(table, set())
    bool_cols = BOOL_COLUMNS.get(table, set())
    for key in row.keys():
        if key not in dest_columns:
            continue
        value = row[key]
        if key in json_cols:
            value = _coerce_json(value)
        elif key in bool_cols:
            value = _coerce_bool(value)
        data[key] = value
    if table == "users" and not data.get("role"):
        data["role"] = "student"
    return data


def _table_count(conn, table: str) -> int:
    return int(conn.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar() or 0)


def _reset_id_sequence(conn, table: str) -> None:
    conn.execute(
        text(
            f"""
            DO $$
            DECLARE
                seq text;
            BEGIN
                seq := pg_get_serial_sequence('{table}', 'id');
                IF seq IS NOT NULL THEN
                    PERFORM setval(seq, COALESCE((SELECT MAX(id) FROM "{table}"), 1), true);
                END IF;
            END $$;
            """
        )
    )


def main() -> int:
    args = _parse_args()
    sqlite_path = Path(args.sqlite)
    if not sqlite_path.exists():
        print(f"未找到 SQLite 文件：{sqlite_path}")
        return 1

    if settings.database_url.startswith("sqlite"):
        print("当前 DATABASE_URL 仍是 SQLite，请先改成 PostgreSQL 后再导入。")
        return 1

    pg_engine = create_engine(settings.database_url)
    inspector = inspect(pg_engine)
    dest_tables = set(inspector.get_table_names())

    sqlite_conn = sqlite3.connect(str(sqlite_path))
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_tables = {
        row[0]
        for row in sqlite_conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }

    with pg_engine.connect() as probe:
        existing_rows = 0
        for table in TABLE_ORDER:
            if table in dest_tables:
                existing_rows += _table_count(probe, table)
        if existing_rows and not args.force:
            print(f"PostgreSQL 已有 {existing_rows} 行业务数据，跳过导入（需要覆盖时加 --force）。")
            return 0

    print(f"从 {sqlite_path} 导入到 {settings.database_url}")
    skipped = sorted((sqlite_tables - set(TABLE_ORDER)) | SKIP_SQLITE_TABLES)
    if skipped:
        print("跳过表：" + ", ".join(skipped))

    metadata = MetaData()
    with pg_engine.begin() as conn:
        conn.execute(text("SET session_replication_role = replica"))
        if args.force:
            for table in reversed(TABLE_ORDER):
                if table in dest_tables:
                    conn.execute(text(f'TRUNCATE TABLE "{table}" RESTART IDENTITY CASCADE'))

        imported = []
        for table in TABLE_ORDER:
            if table not in sqlite_tables:
                continue
            if table not in dest_tables:
                print(f"目标库没有表 {table}，跳过")
                continue
            dest_columns = {col["name"] for col in inspector.get_columns(table)}
            rows = sqlite_conn.execute(f'SELECT * FROM "{table}"').fetchall()
            payload = [_row_to_dict(table, row, dest_columns) for row in rows]
            if not payload:
                imported.append(f"{table}: 0")
                continue
            table_obj = Table(table, metadata, autoload_with=conn)
            conn.execute(table_obj.insert(), payload)
            _reset_id_sequence(conn, table)
            imported.append(f"{table}: {len(payload)}")
        conn.execute(text("SET session_replication_role = DEFAULT"))

    print("已导入：" + "; ".join(imported))
    sqlite_conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
