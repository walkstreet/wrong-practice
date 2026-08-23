from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.deps import get_db, require
from app.permissions import Permission

router = APIRouter(prefix="/api/v1", tags=["taxonomy"])


@router.get("/knowledge-tags", response_model=list[schemas.KnowledgeTagOut], dependencies=[require(Permission.TAXONOMY_VIEW)])
def list_knowledge_tags(db: Session = Depends(get_db)) -> list[models.KnowledgeTag]:
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


@router.post("/knowledge-tags", response_model=schemas.KnowledgeTagOut, dependencies=[require(Permission.TAXONOMY_MANAGE)])
def create_knowledge_tag(
    payload: schemas.KnowledgeTagCreate,
    db: Session = Depends(get_db),
) -> models.KnowledgeTag:
    item = models.KnowledgeTag(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/knowledge-tags/{tag_id}", response_model=schemas.KnowledgeTagOut, dependencies=[require(Permission.TAXONOMY_MANAGE)])
def update_knowledge_tag(
    tag_id: int,
    payload: schemas.KnowledgeTagCreate,
    db: Session = Depends(get_db),
) -> models.KnowledgeTag:
    item = db.get(models.KnowledgeTag, tag_id)
    if not item:
        raise HTTPException(status_code=404, detail="Knowledge tag not found")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.get("/question-types", response_model=list[schemas.QuestionTypeOut], dependencies=[require(Permission.TAXONOMY_VIEW)])
def list_question_types(db: Session = Depends(get_db)) -> list[models.QuestionType]:
    return list(
        db.query(models.QuestionType)
        .order_by(models.QuestionType.sort_order.asc(), models.QuestionType.id.asc())
        .all()
    )


@router.post("/question-types", response_model=schemas.QuestionTypeOut, dependencies=[require(Permission.TAXONOMY_MANAGE)])
def create_question_type(
    payload: schemas.QuestionTypeCreate,
    db: Session = Depends(get_db),
) -> models.QuestionType:
    item = models.QuestionType(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/question-types/{type_id}", response_model=schemas.QuestionTypeOut, dependencies=[require(Permission.TAXONOMY_MANAGE)])
def update_question_type(
    type_id: int,
    payload: schemas.QuestionTypeCreate,
    db: Session = Depends(get_db),
) -> models.QuestionType:
    item = db.get(models.QuestionType, type_id)
    if not item:
        raise HTTPException(status_code=404, detail="Question type not found")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item
