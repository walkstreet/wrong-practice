from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.deps import DifyAuth, get_db

router = APIRouter(prefix="/api/v1/integrations/dify", tags=["dify"])


@router.get("/knowledge-tags", response_model=list[schemas.KnowledgeTagOut], dependencies=[DifyAuth])
def dify_list_knowledge_tags(db: Session = Depends(get_db)) -> list[models.KnowledgeTag]:
    items = list(db.query(models.KnowledgeTag).all())
    by_id = {item.id: item for item in items}
    root_order = ["语法", "词汇", "构词法", "完形填空", "阅读理解", "写作", "听力", "翻译"]
    root_rank = {name: idx for idx, name in enumerate(root_order)}

    def path_parts(tag: models.KnowledgeTag) -> list[str]:
        parts: list[str] = []
        current: models.KnowledgeTag | None = tag
        guard: set[int] = set()
        while current is not None and current.id not in guard:
            guard.add(current.id)
            parts.append(current.name)
            if current.parent_id is None:
                break
            current = by_id.get(current.parent_id)
        parts.reverse()
        return parts

    def path_key(tag: models.KnowledgeTag) -> tuple:
        parts = path_parts(tag)
        root = parts[0] if parts else ""
        return (root_rank.get(root, 1000), root, len(parts), "\0".join(parts), tag.id)

    return sorted(items, key=path_key)


@router.get("/question-types", response_model=list[schemas.QuestionTypeOut], dependencies=[DifyAuth])
def dify_list_question_types(db: Session = Depends(get_db)) -> list[models.QuestionType]:
    return list(
        db.query(models.QuestionType)
        .order_by(models.QuestionType.sort_order.asc(), models.QuestionType.id.asc())
        .all()
    )


@router.get("/wrong-questions", response_model=schemas.WrongQuestionListOut, dependencies=[DifyAuth])
def dify_list_wrong_questions(
    page: int = 1,
    page_size: int = 20,
    id: int | None = None,
    question_type_id: int | None = None,
    knowledge_tag_id: int | None = None,
    review_status: models.ReviewStatus | None = None,
    keyword: str | None = None,
    db: Session = Depends(get_db),
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
    )
    return schemas.WrongQuestionListOut(
        total=total,
        items=[crud.serialize_wrong_question(item) for item in items],
    )


@router.get("/wrong-questions/{question_id}", response_model=schemas.WrongQuestionOut, dependencies=[DifyAuth])
def dify_get_wrong_question(
    question_id: int,
    db: Session = Depends(get_db),
) -> schemas.WrongQuestionOut:
    item = crud.get_wrong_question(db, question_id)
    if not item or item.deleted:
        raise HTTPException(status_code=404, detail="Wrong question not found")
    return crud.serialize_wrong_question(item)


@router.post(
    "/wrong-questions/batch",
    response_model=schemas.WrongQuestionBatchOut,
    dependencies=[DifyAuth],
)
def dify_create_wrong_questions_batch(
    payload: schemas.WrongQuestionDifyBatchIn,
    db: Session = Depends(get_db),
) -> schemas.WrongQuestionBatchOut:
    items = crud.create_wrong_questions_batch(db, payload.items)
    serialized = [crud.serialize_wrong_question(item) for item in items]
    return schemas.WrongQuestionBatchOut(total=len(serialized), items=serialized)


@router.post("/practice-records", dependencies=[DifyAuth])
def create_practice_record(
    payload: schemas.PracticeRecordIn,
    db: Session = Depends(get_db),
) -> dict[str, str | int]:
    question = crud.get_wrong_question(db, payload.wrong_question_id)
    if not question or question.deleted:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Wrong question not found")

    crud.create_practice_record(db, payload)
    return {"status": "ok", "count": crud.count_practice_records(db)}
