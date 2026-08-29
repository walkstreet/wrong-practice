from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import SessionLocal
from app.models import KnowledgeTag, QuestionType, User, UserRole
from app.routers.admin_activity import router as admin_activity_router
from app.routers.admin_assignments import router as admin_assignments_router
from app.routers.admin_students import router as admin_students_router
from app.routers.admin_system import router as admin_system_router
from app.routers.admin_users import router as admin_users_router
from app.routers.auth import router as auth_router
from app.routers.health import router as health_router
from app.routers.me_assignments import router as me_assignments_router
from app.routers.practice import router as practice_router
from app.routers.taxonomy import router as taxonomy_router
from app.routers.web import router as web_router
from app.routers.wrong_questions import router as wrong_questions_router
from app.security import hash_password

_docs_enabled = settings.enable_docs
app = FastAPI(
    title="Wrong Question Service",
    version="0.1.0",
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://wrong.eduglow.top:5174",
        "http://wrong.eduglow.top",
        "https://wrong.eduglow.top",
    ],
    # 局域网 IP:5174，或 *.eduglow.top（任意端口 / http(s)）
    allow_origin_regex=r"^https?://((\d{1,3}\.){3}\d{1,3}|([a-zA-Z0-9-]+\.)*eduglow\.top)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_uploads_dir = Path(__file__).resolve().parents[1] / "uploads"
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")


def seed_data() -> None:
    # 中学英语错题题型体系：大类 + 标准题型名 + 录入说明 + 排序
    # 已有同名题型会更新描述/分类/排序，不会改 id，不影响已入库错题。
    question_types_seed = [
        # 听力
        ("听力理解", "听录音作答（选择/填空/判断）", "听力", 10),
        # 选择
        ("单项选择", "单题四选一，考查语法/词汇/搭配", "选择类", 20),
        # 语篇阅读
        ("完形填空", "短文多空选择，options 用二维数组按小题分组", "语篇阅读", 30),
        ("阅读理解", "短文后若干选择题，材料写入 stem，小题选项可用二维数组", "语篇阅读", 31),
        ("七选五", "阅读还原：从选项中选出合适句子填入空缺", "语篇阅读", 32),
        # 语言运用
        ("语法填空", "语篇多空填词；options 一般为 []，答案按空序数组", "语言运用", 40),
        ("短文改错", "找出并改正短文中的错误", "语言运用", 41),
        ("单词拼写", "根据中文/首字母写出单词", "语言运用", 42),
        # 表达与改写
        ("句型转换", "按要求改写句子（同义句、时态语态、感叹句等）", "表达与改写", 50),
        ("完成句子", "根据提示完成句子/填入正确形式", "表达与改写", 51),
        ("翻译", "中英互译（词组/句子/段落）", "表达与改写", 52),
        ("书面表达", "应用文/续写/概要等写作题", "表达与改写", 53),
    ]

    # 使用路径方式定义知识点，自动生成父子层级，重复执行不会重复插入。
    knowledge_tag_paths = [
        ("语法",),
        ("语法", "时态语态"),
        ("语法", "时态语态", "一般现在时"),
        ("语法", "时态语态", "一般过去时"),
        ("语法", "时态语态", "一般将来时"),
        ("语法", "时态语态", "现在进行时"),
        ("语法", "时态语态", "过去进行时"),
        ("语法", "时态语态", "现在完成时"),
        ("语法", "时态语态", "过去完成时"),
        ("语法", "时态语态", "被动语态"),
        ("语法", "非谓语动词"),
        ("语法", "非谓语动词", "不定式 to do"),
        ("语法", "非谓语动词", "动名词 doing"),
        ("语法", "非谓语动词", "分词 done/doing"),
        ("语法", "从句"),
        ("语法", "从句", "定语从句"),
        ("语法", "从句", "名词性从句"),
        ("语法", "从句", "状语从句"),
        ("语法", "虚拟语气"),
        ("语法", "主谓一致"),
        ("语法", "倒装"),
        ("语法", "强调句"),
        ("语法", "情态动词"),
        ("语法", "冠词"),
        ("语法", "代词"),
        ("语法", "介词"),
        ("语法", "连词"),
        ("语法", "形容词副词"),
        ("语法", "比较级最高级"),
        ("语法", "句子成分与句子结构"),
        ("词汇",),
        ("词汇", "词义辨析"),
        ("词汇", "近义词辨析"),
        ("词汇", "一词多义"),
        ("词汇", "词形变化"),
        ("词汇", "固定搭配"),
        ("词汇", "短语动词"),
        ("词汇", "高频词汇"),
        ("词汇", "学术词汇"),
        ("词汇", "熟词生义"),
        ("构词法",),
        ("构词法", "前缀"),
        ("构词法", "后缀"),
        ("构词法", "词根"),
        ("构词法", "合成词"),
        ("完形填空",),
        ("完形填空", "语境推断"),
        ("完形填空", "逻辑关系"),
        ("完形填空", "固定搭配"),
        ("完形填空", "词义辨析"),
        ("阅读理解",),
        ("阅读理解", "主旨大意"),
        ("阅读理解", "细节理解"),
        ("阅读理解", "推理判断"),
        ("阅读理解", "词义猜测"),
        ("阅读理解", "观点态度"),
        ("阅读理解", "篇章结构"),
        ("写作",),
        ("写作", "句式多样性"),
        ("写作", "连接与衔接"),
        ("写作", "语法准确性"),
        ("写作", "词汇准确性"),
        ("写作", "审题与立意"),
        ("听力",),
        ("听力", "关键词捕捉"),
        ("听力", "同义替换识别"),
        ("听力", "数字时间地点"),
        ("听力", "主旨与意图"),
        ("翻译",),
        ("翻译", "时态转换"),
        ("翻译", "从句转换"),
        ("翻译", "固定表达"),
        ("翻译", "语序调整"),
    ]

    db = SessionLocal()
    try:
        # 题型幂等初始化 / 同步分类与排序
        existing_by_name = {item.name: item for item in db.query(QuestionType).all()}
        for type_name, type_desc, category, sort_order in question_types_seed:
            existing = existing_by_name.get(type_name)
            if existing:
                existing.description = type_desc
                existing.category = category
                existing.sort_order = sort_order
                if existing.status != "active":
                    existing.status = "active"
                continue
            db.add(
                QuestionType(
                    name=type_name,
                    description=type_desc,
                    category=category,
                    sort_order=sort_order,
                    status="active",
                )
            )

        db.flush()

        # 知识点幂等初始化（按 parent_id + name 去重）
        path_to_id: dict[tuple[str, ...], int] = {}
        existing_tags = db.query(KnowledgeTag).all()
        by_parent_and_name = {
            (item.parent_id, item.name): item for item in existing_tags
        }

        for path in knowledge_tag_paths:
            parent_id = None
            current_path: list[str] = []
            for node_name in path:
                current_path.append(node_name)
                current_tuple = tuple(current_path)

                if current_tuple in path_to_id:
                    parent_id = path_to_id[current_tuple]
                    continue

                key = (parent_id, node_name)
                tag = by_parent_and_name.get(key)
                if not tag:
                    tag = KnowledgeTag(name=node_name, parent_id=parent_id, status="active")
                    db.add(tag)
                    db.flush()
                    by_parent_and_name[key] = tag

                path_to_id[current_tuple] = tag.id
                parent_id = tag.id

        # 停用历史扁平根标签，避免与系统树（语法/时态语态…）重复干扰录入
        legacy_flat_roots = {"时态", "从句"}
        for tag in db.query(KnowledgeTag).filter(KnowledgeTag.parent_id.is_(None)).all():
            if tag.name in legacy_flat_roots and tag.status != "inactive":
                tag.status = "inactive"

        # 默认管理员账号（幂等）
        admin = db.query(User).filter(User.username == settings.admin_username).first()
        if not admin:
            db.add(
                User(
                    username=settings.admin_username,
                    password_hash=hash_password(settings.admin_password),
                    role=UserRole.superadmin,
                    is_active=True,
                )
            )
        else:
            admin.role = UserRole.superadmin
            admin.is_active = True

        db.commit()
    finally:
        db.close()


@app.on_event("startup")
def on_startup() -> None:
    from app.db_schema import upgrade_schema_to_head

    upgrade_schema_to_head()
    seed_data()


app.include_router(health_router)
app.include_router(auth_router)
app.include_router(admin_users_router)
app.include_router(admin_activity_router)
app.include_router(admin_system_router)
app.include_router(admin_assignments_router)
app.include_router(admin_students_router)
app.include_router(me_assignments_router)
app.include_router(web_router)
app.include_router(wrong_questions_router)
app.include_router(practice_router)
app.include_router(taxonomy_router)

