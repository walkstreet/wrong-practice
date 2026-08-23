from datetime import datetime
from pathlib import Path
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.deps import get_db, require
from app.permissions import Permission, can_access_wrong_question, is_superadmin
from app.services import ai_import_drafts, llm as llm_service

router = APIRouter(prefix="/api/v1", tags=["wrong-questions"])

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "ai-import"
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGES = 5
MANAGE_FORBIDDEN = "只能改删自己录入的题目"


def _require_manage(actor, item, *, deleted_ok: bool = False, not_found: str = "Wrong question not found"):
    if not item or (item.deleted and not deleted_ok) or (not item.deleted and deleted_ok):
        raise HTTPException(status_code=404, detail=not_found)
    if not can_access_wrong_question(actor, item):
        raise HTTPException(status_code=403, detail=MANAGE_FORBIDDEN)
    return item


@router.post("/wrong-questions", response_model=schemas.WrongQuestionOut)
def create_wrong_question(
    payload: schemas.WrongQuestionCreate,
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_CREATE),
) -> schemas.WrongQuestionOut:
    item = crud.create_wrong_question(db, payload, created_by=actor.id)
    crud.write_activity_log(
        db,
        actor=actor,
        action="question.create",
        resource_type="wrong_question",
        resource_id=item.id,
        summary=f"{actor.username} 录入题目 #{item.id}「{crud._stem_snippet(item.stem)}」",
        commit=True,
    )
    return crud.serialize_wrong_questions(db, [item], actor)[0]


@router.post("/wrong-questions/ocr", response_model=schemas.WrongQuestionOut)
def ingest_wrong_question_by_ocr(
    payload: schemas.OCRIngestRequest,
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_CREATE),
) -> schemas.WrongQuestionOut:
    # V1: OCR engine can be plugged here. For now, if extracted is not provided,
    # this endpoint stores raw OCR text and expects client to pass structured fields.
    if not payload.extracted:
        raise HTTPException(
            status_code=422,
            detail="For V1 scaffold, extracted structured fields are required",
        )

    data = payload.extracted.model_copy(update={"ocr_raw_text": payload.raw_text})
    create_payload = schemas.WrongQuestionCreate(
        **data.model_dump(),
        ingest_source=models.IngestSource.ocr,
    )
    item = crud.create_wrong_question(db, create_payload, created_by=actor.id)
    crud.write_activity_log(
        db,
        actor=actor,
        action="question.create",
        resource_type="wrong_question",
        resource_id=item.id,
        summary=f"{actor.username} 通过 OCR 录入题目 #{item.id}",
        commit=True,
    )
    return crud.serialize_wrong_questions(db, [item], actor)[0]


def _active_knowledge_tags_with_paths(db: Session) -> list[dict]:
    all_tags = (
        db.query(models.KnowledgeTag)
        .filter(models.KnowledgeTag.status == "active")
        .all()
    )
    tag_by_id = {t.id: t for t in all_tags}

    def tag_path_name(tag: models.KnowledgeTag) -> str:
        parts: list[str] = []
        current: models.KnowledgeTag | None = tag
        guard: set[int] = set()
        while current is not None and current.id not in guard:
            guard.add(current.id)
            parts.append(current.name)
            if current.parent_id is None:
                break
            current = tag_by_id.get(current.parent_id)
        parts.reverse()
        return " / ".join(parts)

    knowledge_tags = [{"id": t.id, "name": tag_path_name(t)} for t in all_tags]
    knowledge_tags.sort(key=lambda x: x["name"])
    return knowledge_tags


@router.post("/wrong-questions/suggest-knowledge-tags", response_model=schemas.SuggestKnowledgeTagsOut, dependencies=[require(Permission.QUESTION_CREATE)])
async def suggest_knowledge_tags(
    payload: schemas.SuggestKnowledgeTagsIn,
    db: Session = Depends(get_db),
) -> schemas.SuggestKnowledgeTagsOut:
    knowledge_tags = _active_knowledge_tags_with_paths(db)
    if not knowledge_tags:
        raise HTTPException(status_code=422, detail="知识点目录为空")

    try:
        items, warnings, model = await llm_service.suggest_knowledge_tags(
            stem=payload.stem,
            options=payload.options,
            correct_answer=payload.correct_answer,
            wrong_answer=payload.wrong_answer,
            question_type_name=payload.question_type_name,
            note=payload.note,
            knowledge_tags=knowledge_tags,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"知识点推荐失败: {exc}") from exc

    return schemas.SuggestKnowledgeTagsOut(
        knowledge_tag_ids=[item["id"] for item in items],
        items=[schemas.SuggestKnowledgeTagItem.model_validate(item) for item in items],
        model=model,
        warnings=warnings,
    )


@router.post("/wrong-questions/ai-extract", response_model=schemas.AiExtractOut, dependencies=[require(Permission.QUESTION_CREATE)])
async def ai_extract_wrong_questions(
    files: list[UploadFile] = File(..., description="试卷/错题图片，最多 5 张"),
    db: Session = Depends(get_db),
) -> schemas.AiExtractOut:
    if not files:
        raise HTTPException(status_code=422, detail="请至少上传一张图片")
    if len(files) > MAX_IMAGES:
        raise HTTPException(status_code=422, detail=f"最多上传 {MAX_IMAGES} 张图片")

    images: list[tuple[str, bytes]] = []
    image_urls: list[str] = []
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    for upload in files:
        content_type = (upload.content_type or "").split(";")[0].strip().lower()
        if content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=422,
                detail=f"不支持的图片类型: {upload.content_type or 'unknown'}，仅支持 JPEG/PNG/WebP/GIF",
            )
        raw = await upload.read()
        if not raw:
            raise HTTPException(status_code=422, detail=f"图片为空: {upload.filename or 'unnamed'}")
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=422, detail="单张图片不能超过 10MB")

        ext = ALLOWED_IMAGE_TYPES[content_type]
        filename = f"{uuid.uuid4().hex}{ext}"
        path = UPLOAD_DIR / filename
        path.write_bytes(raw)
        image_urls.append(f"/uploads/ai-import/{filename}")
        images.append((content_type, raw))

    question_types = [
        {"id": t.id, "name": t.name, "category": t.category}
        for t in db.query(models.QuestionType)
        .filter(models.QuestionType.status == "active")
        .order_by(models.QuestionType.sort_order.asc(), models.QuestionType.id.asc())
        .all()
    ]
    knowledge_tags = _active_knowledge_tags_with_paths(db)

    try:
        items, raw_text, model = await llm_service.extract_questions_from_images(
            images=images,
            question_types=question_types,
            knowledge_tags=knowledge_tags,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI 识别失败: {exc}") from exc

    if not items:
        raise HTTPException(status_code=422, detail="未能从图片中识别出题目，请换更清晰的图片或改用手动录入")

    draft = ai_import_drafts.create_draft(
        items=items,
        image_urls=image_urls,
        raw_text=raw_text,
        model=model,
    )
    safe_items: list[schemas.AiExtractDraftItem] = []
    for item in draft.items:
        try:
            safe_items.append(schemas.AiExtractDraftItem.model_validate(item))
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"识别结果字段校验失败: {exc}",
            ) from exc

    return schemas.AiExtractOut(
        draft_id=draft.draft_id,
        items=safe_items,
        image_urls=draft.image_urls,
        raw_text=draft.raw_text,
        model=draft.model,
    )


@router.get("/wrong-questions/ai-extract/{draft_id}", response_model=schemas.AiExtractOut, dependencies=[require(Permission.QUESTION_CREATE)])
def get_ai_extract_draft(draft_id: str) -> schemas.AiExtractOut:
    draft = ai_import_drafts.get_draft(draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="识别草稿不存在或已过期，请重新上传识别")
    return schemas.AiExtractOut(
        draft_id=draft.draft_id,
        items=[schemas.AiExtractDraftItem.model_validate(i) for i in draft.items],
        image_urls=draft.image_urls,
        raw_text=draft.raw_text,
        model=draft.model,
    )


@router.put("/wrong-questions/ai-extract/{draft_id}", response_model=schemas.AiExtractOut, dependencies=[require(Permission.QUESTION_CREATE)])
def update_ai_extract_draft(
    draft_id: str, payload: schemas.AiExtractConfirmIn
) -> schemas.AiExtractOut:
    draft = ai_import_drafts.get_draft(draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="识别草稿不存在或已过期，请重新上传识别")
    items = [item.model_dump() for item in payload.items]
    updated = ai_import_drafts.update_draft_items(draft_id, items)
    assert updated is not None
    return schemas.AiExtractOut(
        draft_id=updated.draft_id,
        items=[schemas.AiExtractDraftItem.model_validate(i) for i in updated.items],
        image_urls=updated.image_urls,
        raw_text=updated.raw_text,
        model=updated.model,
    )


@router.post("/wrong-questions/ai-extract/{draft_id}/confirm", response_model=schemas.AiExtractConfirmOut)
def confirm_ai_extract_draft(
    draft_id: str,
    payload: schemas.AiExtractConfirmIn,
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_CREATE),
) -> schemas.AiExtractConfirmOut:
    draft = ai_import_drafts.get_draft(draft_id)
    # 服务端热重载后内存草稿会丢；只要前端仍提交完整 items，允许继续导入
    raw_text = draft.raw_text if draft else None
    image_urls = draft.image_urls if draft else []
    model_name = draft.model if draft else None

    selected = [item for item in payload.items if item.selected]
    if not selected:
        raise HTTPException(status_code=422, detail="请至少勾选一道题再确认导入")

    create_payloads: list[schemas.WrongQuestionCreate] = []
    for idx, item in enumerate(selected, start=1):
        if not item.stem.strip():
            raise HTTPException(status_code=422, detail=f"第 {idx} 题题干不能为空")
        if item.question_type_id is None:
            raise HTTPException(status_code=422, detail=f"第 {idx} 题请选择题型")
        if not item.knowledge_tag_ids:
            raise HTTPException(status_code=422, detail=f"第 {idx} 题请至少选择一个知识点")
        if not item.correct_answer:
            raise HTTPException(status_code=422, detail=f"第 {idx} 题请填写正确答案")
        if not item.wrong_answer:
            raise HTTPException(status_code=422, detail=f"第 {idx} 题请填写学生错答")

        try:
            create_payloads.append(
                schemas.WrongQuestionCreate(
                    stem=item.stem.strip(),
                    options=item.options,
                    correct_answer=item.correct_answer,
                    wrong_answer=item.wrong_answer,
                    question_type_id=item.question_type_id,
                    knowledge_tag_ids=item.knowledge_tag_ids,
                    difficulty=item.difficulty,
                    source=item.source,
                    note=item.note,
                    ocr_raw_text=raw_text,
                    ocr_payload={
                        "draft_id": draft_id,
                        "local_id": item.local_id,
                        "confidence": item.confidence,
                        "warnings": item.warnings,
                        "model": model_name,
                        "image_urls": image_urls,
                    },
                    ingest_source=models.IngestSource.ocr,
                )
            )
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"第 {idx} 题校验失败: {exc}") from exc

    created = crud.create_wrong_questions_batch(db, create_payloads, created_by=actor.id)
    crud.write_activity_log(
        db,
        actor=actor,
        action="question.create",
        resource_type="wrong_question",
        resource_id=created[0].id if created else None,
        summary=f"{actor.username} 通过 AI 导入 {len(created)} 道题目",
        extra={"ids": [q.id for q in created]},
        commit=True,
    )
    if draft:
        ai_import_drafts.delete_draft(draft_id)
    return schemas.AiExtractConfirmOut(
        imported_count=len(created),
        ids=[q.id for q in created],
    )


@router.get("/wrong-questions/recycle-bin", response_model=schemas.WrongQuestionListOut)
def list_deleted_wrong_questions(
    page: int = 1,
    page_size: int = 20,
    id: int | None = None,
    question_type_id: int | None = None,
    knowledge_tag_id: int | None = None,
    review_status: models.ReviewStatus | None = None,
    keyword: str | None = None,
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_RESTORE),
) -> schemas.WrongQuestionListOut:
    total, items = crud.list_wrong_questions(
        db,
        page=page,
        page_size=page_size,
        question_id=id,
        question_type_id=question_type_id,
        knowledge_tag_id=knowledge_tag_id,
        review_status=review_status,
        keyword=keyword,
        deleted=True,
        actor=actor,
    )
    return schemas.WrongQuestionListOut(
        total=total,
        items=crud.serialize_wrong_questions(db, items, actor),
    )


@router.post("/wrong-questions/{question_id}/restore")
def restore_wrong_question(
    question_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_RESTORE),
) -> dict[str, str]:
    item = crud.get_wrong_question(db, question_id)
    if not item or not item.deleted or not can_access_wrong_question(actor, item):
        raise HTTPException(status_code=404, detail="Deleted wrong question not found")
    item.deleted = False
    crud.write_activity_log(
        db,
        actor=actor,
        action="question.restore",
        resource_type="wrong_question",
        resource_id=item.id,
        summary=f"{actor.username} 还原题目 #{item.id}「{crud._stem_snippet(item.stem)}」",
    )
    db.commit()
    return {"status": "restored"}


@router.delete("/wrong-questions/recycle-bin/{question_id}")
def permanently_delete_wrong_question(
    question_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_RESTORE),
) -> dict[str, str]:
    item = crud.get_wrong_question(db, question_id)
    if not item or not item.deleted or not can_access_wrong_question(actor, item):
        raise HTTPException(status_code=404, detail="Deleted wrong question not found")
    snippet = crud._stem_snippet(item.stem)
    ok = crud.permanently_delete_wrong_question(db, question_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Deleted wrong question not found")
    crud.write_activity_log(
        db,
        actor=actor,
        action="question.purge",
        resource_type="wrong_question",
        resource_id=question_id,
        summary=f"{actor.username} 彻底删除题目 #{question_id}「{snippet}」",
        commit=True,
    )
    return {"status": "purged"}


@router.delete("/wrong-questions/recycle-bin")
def empty_recycle_bin(
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_RESTORE),
) -> dict[str, int | str]:
    deleted_count = crud.empty_recycle_bin(db, actor=actor)
    crud.write_activity_log(
        db,
        actor=actor,
        action="recycle.empty",
        resource_type="recycle_bin",
        summary=f"{actor.username} 清空回收站，删除 {deleted_count} 条",
        extra={"deleted_count": deleted_count},
        commit=True,
    )
    return {"status": "emptied", "deleted_count": deleted_count}


@router.get("/wrong-questions/bank-access", response_model=schemas.QuestionClaimOut)
def get_my_bank_access(
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_VIEW),
) -> schemas.QuestionClaimOut:
    item = crud.latest_bank_request(db, actor)
    if not item:
        raise HTTPException(status_code=404, detail="尚未申请查看全量错题")
    return crud.serialize_claim_request(db, item)


@router.post("/wrong-questions/bank-access", response_model=schemas.QuestionClaimOut)
def request_bank_access(
    payload: schemas.QuestionClaimCreateIn,
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_VIEW),
) -> schemas.QuestionClaimOut:
    if is_superadmin(actor.role):
        raise HTTPException(status_code=400, detail="超管无需申请，可直接查看全部题目")
    if crud.has_bank_view_access(db, actor):
        raise HTTPException(status_code=400, detail="已开通全量错题查看，无需再次申请")
    request = crud.create_question_claim(db, actor=actor, reason=payload.reason)
    return crud.serialize_claim_request(db, request)


@router.get("/wrong-questions/{question_id}", response_model=schemas.WrongQuestionOut)
def get_wrong_question(
    question_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_VIEW),
) -> schemas.WrongQuestionOut:
    item = crud.get_wrong_question(db, question_id)
    if not item or item.deleted:
        raise HTTPException(status_code=404, detail="Wrong question not found")
    if not can_access_wrong_question(actor, item) and not crud.has_bank_view_access(db, actor):
        raise HTTPException(status_code=404, detail="Wrong question not found")
    return crud.serialize_wrong_questions(db, [item], actor)[0]


@router.get("/wrong-questions", response_model=schemas.WrongQuestionListOut)
def list_wrong_questions(
    page: int = 1,
    page_size: int = 20,
    id: int | None = None,
    question_type_id: int | None = None,
    knowledge_tag_id: int | None = None,
    review_status: models.ReviewStatus | None = None,
    keyword: str | None = None,
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_VIEW),
) -> schemas.WrongQuestionListOut:
    total, items = crud.list_wrong_questions(
        db,
        page=page,
        page_size=page_size,
        question_id=id,
        question_type_id=question_type_id,
        knowledge_tag_id=knowledge_tag_id,
        review_status=review_status,
        keyword=keyword,
        deleted=False,
        actor=actor,
        owner_only=not crud.has_bank_view_access(db, actor),
    )
    return schemas.WrongQuestionListOut(
        total=total,
        items=crud.serialize_wrong_questions(db, items, actor),
    )


@router.put("/wrong-questions/{question_id}", response_model=schemas.WrongQuestionOut)
def update_wrong_question(
    question_id: int,
    payload: schemas.WrongQuestionUpdate,
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_EDIT),
) -> schemas.WrongQuestionOut:
    item = _require_manage(actor, crud.get_wrong_question(db, question_id))
    item = crud.update_wrong_question(db, item, payload)
    crud.write_activity_log(
        db,
        actor=actor,
        action="question.update",
        resource_type="wrong_question",
        resource_id=item.id,
        summary=f"{actor.username} 编辑题目 #{item.id}「{crud._stem_snippet(item.stem)}」",
        commit=True,
    )
    return crud.serialize_wrong_questions(db, [item], actor)[0]


@router.delete("/wrong-questions/{question_id}")
def delete_wrong_question(
    question_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_DELETE),
) -> dict[str, str]:
    item = _require_manage(actor, crud.get_wrong_question(db, question_id))
    item.deleted = True
    crud.write_activity_log(
        db,
        actor=actor,
        action="question.delete",
        resource_type="wrong_question",
        resource_id=item.id,
        summary=f"{actor.username} 删除题目 #{item.id}「{crud._stem_snippet(item.stem)}」",
    )
    db.commit()
    return {"status": "deleted"}


@router.post("/wrong-questions/{question_id}/ai-analyze", response_model=schemas.WrongQuestionAiAnalysisOut)
async def analyze_wrong_question_ai(
    question_id: int,
    payload: schemas.WrongQuestionAiAnalyzeIn | None = None,
    db: Session = Depends(get_db),
    actor=require(Permission.QUESTION_ANALYZE),
) -> schemas.WrongQuestionAiAnalysisOut:
    item = _require_manage(actor, crud.get_wrong_question(db, question_id))

    question_type = db.get(models.QuestionType, item.question_type_id)
    question_type_name = question_type.name if question_type else str(item.question_type_id)

    tag_ids = [link.knowledge_tag_id for link in item.tags]
    knowledge_tags = (
        db.query(models.KnowledgeTag).filter(models.KnowledgeTag.id.in_(tag_ids)).all() if tag_ids else []
    )
    tag_name_by_id = {tag.id: tag.name for tag in knowledge_tags}
    knowledge_tag_names = [tag_name_by_id.get(tag_id, str(tag_id)) for tag_id in tag_ids]

    body = payload or schemas.WrongQuestionAiAnalyzeIn()
    focus_sentences = [s.strip() for s in body.focus_sentences if isinstance(s, str) and s.strip()][:3]

    try:
        result, model = await llm_service.analyze_wrong_question(
            stem=item.stem,
            options=item.options,
            correct_answer=item.correct_answer,
            wrong_answer=item.wrong_answer,
            question_type_name=question_type_name,
            knowledge_tag_names=knowledge_tag_names,
            note=item.note,
            focus_sentences=focus_sentences,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI 分析失败: {exc}") from exc

    analyzed_at = datetime.utcnow()
    item.ai_analysis = llm_service.serialize_ai_analysis(result, analyzed_at=analyzed_at, model=model)
    item.ai_analyzed_at = analyzed_at
    item.ai_model = model
    db.commit()
    db.refresh(item)

    return schemas.WrongQuestionAiAnalysisOut(
        sentence_analysis=item.ai_analysis["sentence_analysis"],
        sentence_analyses=item.ai_analysis.get("sentence_analyses")
        or [item.ai_analysis["sentence_analysis"]],
        solving_analysis=item.ai_analysis["solving_analysis"],
        analyzed_at=analyzed_at,
        model=model,
    )
