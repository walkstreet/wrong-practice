from datetime import datetime
from html import escape
from json import dumps

from fastapi import APIRouter, BackgroundTasks, Depends, Form, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from starlette.responses import Response
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.deps import get_db
from app.services.question_analysis import schedule_question_analysis

router = APIRouter(tags=["web"])


@router.get("/", include_in_schema=False)
def index() -> RedirectResponse:
    return RedirectResponse(url="/web/wrong-questions")


@router.get("/web/practice-records", response_class=HTMLResponse, include_in_schema=False)
def web_list_practice_records(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    wrong_question_id: int | None = None,
    db: Session = Depends(get_db),
) -> str:
    total, records = crud.list_practice_records(
        db,
        page=page,
        page_size=page_size,
        wrong_question_id=wrong_question_id,
    )
    stats = crud.get_wrong_question_accuracy_stats(db, limit=20)
    total_pages = (total + page_size - 1) // page_size if total else 1
    prev_page = max(page - 1, 1)
    next_page = min(page + 1, total_pages)

    record_rows: list[str] = []
    for record in records:
        stem = record.wrong_question.stem if record.wrong_question else "-"
        result = "正确" if record.is_correct else "错误"
        preview = dumps(record.generated_question, ensure_ascii=False)[:120]
        record_rows.append(
            "<tr>"
            f"<td>{record.id}</td>"
            f"<td><a href='/web/wrong-questions/{record.wrong_question_id}'>{record.wrong_question_id}</a></td>"
            f"<td>{escape(stem[:60])}</td>"
            f"<td>{escape(result)}</td>"
            f"<td><code>{escape(preview)}</code></td>"
            f"<td>{record.answered_at.strftime('%Y-%m-%d %H:%M:%S')}</td>"
            "</tr>"
        )
    record_rows_html = "\n".join(record_rows) if record_rows else "<tr><td colspan='6'>暂无练习记录</td></tr>"

    stat_rows: list[str] = []
    for item in stats:
        stat_rows.append(
            "<tr>"
            f"<td><a href='/web/wrong-questions/{item.wrong_question_id}'>{item.wrong_question_id}</a></td>"
            f"<td>{escape(item.stem[:60])}</td>"
            f"<td>{item.total_attempts}</td>"
            f"<td>{item.correct_attempts}</td>"
            f"<td>{round(item.accuracy_rate * 100, 2)}%</td>"
            "</tr>"
        )
    stat_rows_html = "\n".join(stat_rows) if stat_rows else "<tr><td colspan='5'>暂无统计数据</td></tr>"

    query_suffix = (
        f"&page_size={page_size}"
        f"&wrong_question_id={wrong_question_id or ''}"
    )

    return f"""
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>练习记录（MVP）</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; }}
    h1, h2 {{ margin-bottom: 12px; }}
    table {{ width: 100%; border-collapse: collapse; margin-bottom: 20px; }}
    th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }}
    th {{ background: #f5f5f5; }}
    form {{ display: flex; gap: 10px; margin-bottom: 12px; }}
    input, button {{ padding: 6px 10px; }}
    .nav a {{ margin-right: 12px; }}
    code {{ white-space: pre-wrap; }}
  </style>
</head>
<body>
  <div class="nav">
    <a href="/web/wrong-questions">题库管理</a>
    <a href="/web/wrong-questions/new">手动新增</a>
  </div>

  <h1>练习记录</h1>
  <form method="get" action="/web/practice-records">
    <input name="wrong_question_id" placeholder="按错题 ID 过滤" value="{escape(str(wrong_question_id or ''))}" />
    <button type="submit">筛选</button>
  </form>
  <p>总数：{total}，第 {page}/{total_pages} 页</p>
  <table>
    <thead>
      <tr>
        <th>ID</th><th>错题ID</th><th>题干</th><th>结果</th><th>生成题预览</th><th>作答时间</th>
      </tr>
    </thead>
    <tbody>{record_rows_html}</tbody>
  </table>
  <p>
    <a href="/web/practice-records?page={prev_page}{query_suffix}">上一页</a>
    <a href="/web/practice-records?page={next_page}{query_suffix}">下一页</a>
  </p>

  <h2>错题正确率统计（Top 20）</h2>
  <table>
    <thead>
      <tr><th>错题ID</th><th>题干</th><th>总次数</th><th>答对次数</th><th>正确率</th></tr>
    </thead>
    <tbody>{stat_rows_html}</tbody>
  </table>
</body>
</html>
"""


def _new_question_form_html(
    question_types: list[models.QuestionType],
    knowledge_tags: list[models.KnowledgeTag],
    error_message: str = "",
) -> str:
    type_options = "".join(f"<option value='{item.id}'>{escape(item.name)}</option>" for item in question_types)
    tag_tips = ", ".join(f"{item.id}:{item.name}" for item in knowledge_tags)
    error_html = f"<p style='color:#b00020;'>{escape(error_message)}</p>" if error_message else ""
    return f"""
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>新增题目</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; max-width: 880px; }}
    label {{ display: block; margin: 10px 0 6px; font-weight: 600; }}
    input, textarea, select {{ width: 100%; padding: 8px; box-sizing: border-box; }}
    button {{ margin-top: 12px; padding: 8px 14px; }}
    .tip {{ color: #666; font-size: 12px; margin-top: 4px; }}
  </style>
</head>
<body>
  <a href="/web/wrong-questions">← 返回列表</a>
  <h1>手动新增题目</h1>
  {error_html}
  <form method="post" action="/web/wrong-questions/new">
    <label>题干</label>
    <textarea name="stem" rows="4" required></textarea>

    <label>选项（逗号分隔）</label>
    <input name="options_csv" placeholder="A. xxx, B. yyy, C. zzz" required />

    <label>正确答案（逗号分隔）</label>
    <input name="correct_answer_csv" placeholder="A" required />

    <label>题型</label>
    <select name="question_type_id">{type_options}</select>

    <label>知识点 ID（逗号分隔）</label>
    <input name="knowledge_tag_ids_csv" placeholder="1,2" required />
    <div class="tip">可选知识点：{escape(tag_tips)}</div>

    <label>来源（可选）</label>
    <input name="source" placeholder="考试/练习册/平台" />

    <label>备注（可选）</label>
    <textarea name="note" rows="2"></textarea>

    <button type="submit">保存</button>
  </form>
</body>
</html>
"""


@router.get("/web/wrong-questions/new", response_class=HTMLResponse, include_in_schema=False)
def web_new_wrong_question_form(db: Session = Depends(get_db)) -> str:
    question_types = list(db.query(models.QuestionType).order_by(models.QuestionType.id).all())
    knowledge_tags = list(db.query(models.KnowledgeTag).order_by(models.KnowledgeTag.id).all())
    return _new_question_form_html(question_types, knowledge_tags)


@router.post("/web/wrong-questions/new", include_in_schema=False)
def web_create_wrong_question(
    background_tasks: BackgroundTasks,
    stem: str = Form(...),
    options_csv: str = Form(...),
    correct_answer_csv: str = Form(...),
    question_type_id: int = Form(...),
    knowledge_tag_ids_csv: str = Form(...),
    source: str = Form(default=""),
    note: str = Form(default=""),
    db: Session = Depends(get_db),
) -> Response:
    def parse_csv(text: str) -> list[str]:
        return [part.strip() for part in text.split(",") if part.strip()]

    question_types = list(db.query(models.QuestionType).order_by(models.QuestionType.id).all())
    knowledge_tags = list(db.query(models.KnowledgeTag).order_by(models.KnowledgeTag.id).all())
    available_type_ids = {item.id for item in question_types}
    available_tag_ids = {item.id for item in knowledge_tags}

    try:
        options = parse_csv(options_csv)
        correct_answer = parse_csv(correct_answer_csv)
        knowledge_tag_ids = [int(item) for item in parse_csv(knowledge_tag_ids_csv)]
    except ValueError:
        return HTMLResponse(
            _new_question_form_html(question_types, knowledge_tags, "知识点 ID 必须是数字，多个值用逗号分隔。"),
            status_code=400,
        )

    if question_type_id not in available_type_ids:
        return HTMLResponse(
            _new_question_form_html(question_types, knowledge_tags, "题型无效，请先创建题型。"),
            status_code=400,
        )

    if any(tag_id not in available_tag_ids for tag_id in knowledge_tag_ids):
        return HTMLResponse(
            _new_question_form_html(question_types, knowledge_tags, "存在无效知识点 ID，请检查后重试。"),
            status_code=400,
        )

    try:
        payload = schemas.WrongQuestionCreate(
            stem=stem.strip(),
            options=options,
            correct_answer=correct_answer,
            wrong_answer=[],
            question_type_id=question_type_id,
            knowledge_tag_ids=knowledge_tag_ids,
            source=source.strip() or None,
            note=note.strip() or None,
            ingest_source=models.IngestSource.manual,
        )
    except Exception as exc:  # noqa: BLE001
        return HTMLResponse(
            _new_question_form_html(question_types, knowledge_tags, f"表单校验失败：{exc}"),
            status_code=400,
        )

    created = crud.create_wrong_question(db, payload)
    schedule_question_analysis(background_tasks, [created.id])
    return RedirectResponse(url=f"/web/wrong-questions/{created.id}", status_code=303)


@router.post("/web/wrong-questions/{question_id}/delete", include_in_schema=False)
def web_delete_wrong_question(
    question_id: int,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    item = crud.get_wrong_question(db, question_id)
    if item and not item.deleted:
        item.deleted = True
        item.deleted_at = datetime.utcnow()
        db.commit()
    return RedirectResponse(url="/web/wrong-questions", status_code=303)


@router.get("/web/wrong-questions", response_class=HTMLResponse, include_in_schema=False)
def web_list_wrong_questions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    question_type_id: int | None = None,
    knowledge_tag_id: int | None = None,
    review_status: models.ReviewStatus | None = None,
    keyword: str | None = None,
    db: Session = Depends(get_db),
) -> str:
    total, items = crud.list_wrong_questions(
        db,
        page=page,
        page_size=page_size,
        question_type_id=question_type_id,
        knowledge_tag_id=knowledge_tag_id,
        review_status=review_status,
        keyword=keyword,
    )

    question_types = list(db.query(models.QuestionType).order_by(models.QuestionType.id).all())
    knowledge_tags = list(db.query(models.KnowledgeTag).order_by(models.KnowledgeTag.id).all())
    type_map = {item.id: item.name for item in question_types}
    tag_map = {item.id: item.name for item in knowledge_tags}
    total_pages = (total + page_size - 1) // page_size if total else 1

    def option_html(value: str, label: str, selected: bool) -> str:
        mark = "selected" if selected else ""
        return f'<option value="{escape(value)}" {mark}>{escape(label)}</option>'

    type_options = [option_html("", "全部题型", question_type_id is None)]
    for item in question_types:
        type_options.append(option_html(str(item.id), item.name, question_type_id == item.id))

    tag_options = [option_html("", "全部知识点", knowledge_tag_id is None)]
    for item in knowledge_tags:
        tag_options.append(option_html(str(item.id), item.name, knowledge_tag_id == item.id))

    status_options = [option_html("", "全部状态", review_status is None)]
    for status in models.ReviewStatus:
        status_options.append(option_html(status.value, status.value, review_status == status))

    rows: list[str] = []
    for item in items:
        tag_names = ", ".join(tag_map.get(link.knowledge_tag_id, str(link.knowledge_tag_id)) for link in item.tags)
        rows.append(
            "<tr>"
            f"<td>{item.id}</td>"
            f"<td><a href='/web/wrong-questions/{item.id}'>{escape(item.stem[:80])}</a></td>"
            f"<td>{escape(type_map.get(item.question_type_id, str(item.question_type_id)))}</td>"
            f"<td>{escape(tag_names)}</td>"
            f"<td>{escape(item.review_status.value)}</td>"
            f"<td>{escape(item.ingest_source.value)}</td>"
            "<td>"
            f"<form method='post' action='/web/wrong-questions/{item.id}/delete' "
            "onsubmit=\"return confirm('确认删除这条错题吗？');\" style='display:inline;'>"
            "<button type='submit'>删除</button>"
            "</form>"
            "</td>"
            "</tr>"
        )
    rows_html = "\n".join(rows) if rows else "<tr><td colspan='7'>暂无数据</td></tr>"

    query_base = (
        f"&page_size={page_size}"
        f"&question_type_id={question_type_id or ''}"
        f"&knowledge_tag_id={knowledge_tag_id or ''}"
        f"&review_status={review_status.value if review_status else ''}"
        f"&keyword={escape(keyword or '')}"
    )
    prev_page = max(page - 1, 1)
    next_page = min(page + 1, total_pages)

    return f"""
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>错题管理（MVP）</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; }}
    h1 {{ margin-bottom: 16px; }}
    form {{ display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }}
    input, select, button {{ padding: 6px 10px; }}
    table {{ width: 100%; border-collapse: collapse; }}
    th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
    th {{ background: #f5f5f5; }}
    .meta {{ margin: 10px 0; color: #666; }}
    .pager a {{ margin-right: 10px; }}
  </style>
</head>
<body>
  <h1>题库管理（MVP）</h1>
  <p><a href="/web/wrong-questions/new">+ 手动新增题目</a> | <a href="/web/practice-records">练习记录与统计</a></p>
  <form method="get" action="/web/wrong-questions">
    <input type="text" name="keyword" placeholder="题干关键词" value="{escape(keyword or '')}">
    <select name="question_type_id">{''.join(type_options)}</select>
    <select name="knowledge_tag_id">{''.join(tag_options)}</select>
    <select name="review_status">{''.join(status_options)}</select>
    <button type="submit">筛选</button>
  </form>

  <div class="meta">总数：{total}，当前第 {page}/{total_pages} 页</div>
  <table>
    <thead>
      <tr>
        <th>ID</th><th>题干</th><th>题型</th><th>知识点</th><th>状态</th><th>录入来源</th><th>操作</th>
      </tr>
    </thead>
    <tbody>
      {rows_html}
    </tbody>
  </table>

  <div class="pager" style="margin-top: 12px;">
    <a href="/web/wrong-questions?page={prev_page}{query_base}">上一页</a>
    <a href="/web/wrong-questions?page={next_page}{query_base}">下一页</a>
  </div>
</body>
</html>
"""


@router.get("/web/wrong-questions/{question_id}", response_class=HTMLResponse, include_in_schema=False)
def web_wrong_question_detail(question_id: int, db: Session = Depends(get_db)) -> str:
    item = crud.get_wrong_question(db, question_id)
    if not item or item.deleted:
        return "<h2>题目不存在</h2><a href='/web/wrong-questions'>返回列表</a>"

    type_obj = db.get(models.QuestionType, item.question_type_id)
    tag_ids = [link.knowledge_tag_id for link in item.tags]
    tags = list(db.query(models.KnowledgeTag).filter(models.KnowledgeTag.id.in_(tag_ids)).all()) if tag_ids else []
    tag_names = ", ".join(tag.name for tag in tags) if tags else "-"

    options_html = "".join(f"<li>{escape(opt)}</li>" for opt in item.options)
    correct_html = ", ".join(escape(v) for v in item.correct_answer)
    total_attempts, correct_attempts, accuracy_rate = crud.get_wrong_question_practice_summary(db, item.id)
    recent_records = crud.list_recent_practice_records_by_question(db, item.id, limit=10)
    recent_rows: list[str] = []
    for record in recent_records:
        result_text = "正确" if record.is_correct else "错误"
        question_preview = dumps(record.generated_question, ensure_ascii=False)[:120]
        recent_rows.append(
            "<tr>"
            f"<td>{record.id}</td>"
            f"<td>{escape(result_text)}</td>"
            f"<td><code>{escape(question_preview)}</code></td>"
            f"<td>{record.answered_at.strftime('%Y-%m-%d %H:%M:%S')}</td>"
            "</tr>"
        )
    recent_rows_html = "\n".join(recent_rows) if recent_rows else "<tr><td colspan='4'>暂无练习记录</td></tr>"

    return f"""
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>题目详情 #{item.id}</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; max-width: 900px; }}
    .box {{ background: #f8f8f8; padding: 12px; border-radius: 6px; }}
    li {{ margin-bottom: 6px; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 12px; }}
    th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }}
    th {{ background: #f5f5f5; }}
  </style>
</head>
<body>
  <a href="/web/wrong-questions">← 返回列表</a>
  <h1>题目详情 #{item.id}</h1>
  <p><b>题型：</b>{escape(type_obj.name if type_obj else str(item.question_type_id))}</p>
  <p><b>知识点：</b>{escape(tag_names)}</p>
  <p><b>状态：</b>{escape(item.review_status.value)}</p>
  <p><b>录入来源：</b>{escape(item.ingest_source.value)}</p>
  <p><b>题目来源：</b>{escape(item.source or '--')}</p>
  <div class="box"><b>题干：</b><br>{escape(item.stem)}</div>
  <h3>选项</h3>
  <ul>{options_html}</ul>
  <p><b>正确答案：</b>{correct_html}</p>
  <p><b>备注：</b>{escape(item.note or '-')}</p>
  <h3>练习统计</h3>
  <p><b>总作答：</b>{total_attempts} 次 | <b>答对：</b>{correct_attempts} 次 | <b>正确率：</b>{round(accuracy_rate * 100, 2)}%</p>
  <p><a href="/web/practice-records?wrong_question_id={item.id}">查看该题全部练习记录</a></p>

  <h3>最近 10 次练习</h3>
  <table>
    <thead>
      <tr><th>记录ID</th><th>结果</th><th>生成题预览</th><th>作答时间</th></tr>
    </thead>
    <tbody>{recent_rows_html}</tbody>
  </table>
</body>
</html>
"""
