from __future__ import annotations

from enum import Enum

from app.models import UserRole


class Permission(str, Enum):
    QUESTION_VIEW = "question.view"
    QUESTION_CREATE = "question.create"
    QUESTION_EDIT = "question.edit"
    QUESTION_DELETE = "question.delete"
    QUESTION_RESTORE = "question.restore"
    QUESTION_ANALYZE = "question.analyze"
    TAXONOMY_VIEW = "taxonomy.view"
    TAXONOMY_MANAGE = "taxonomy.manage"
    ASSIGNMENT_MANAGE = "assignment.manage"
    ASSIGNMENT_REVIEW = "assignment.review"
    ASSIGNMENT_TAKE = "assignment.take"
    PRACTICE_VIEW = "practice.view"
    USER_VIEW = "user.view"
    USER_CREATE = "user.create"
    USER_MANAGE = "user.manage"
    SYSTEM_VIEW = "system.view"
    AUDIT_VIEW = "audit.view"


_LEGACY_ROLE_MAP = {
    "admin": UserRole.superadmin,
    "learner": UserRole.student,
}

_TEACHER_PERMISSIONS = frozenset(
    {
        Permission.QUESTION_VIEW,
        Permission.QUESTION_CREATE,
        Permission.QUESTION_EDIT,
        Permission.QUESTION_DELETE,
        Permission.QUESTION_RESTORE,
        Permission.QUESTION_ANALYZE,
        Permission.TAXONOMY_VIEW,
        Permission.TAXONOMY_MANAGE,
        Permission.ASSIGNMENT_MANAGE,
        Permission.ASSIGNMENT_REVIEW,
        Permission.PRACTICE_VIEW,
        Permission.USER_VIEW,
        Permission.USER_CREATE,
        Permission.SYSTEM_VIEW,
    }
)

_ORG_ADMIN_PERMISSIONS = _TEACHER_PERMISSIONS | {
    Permission.USER_MANAGE,
}

ROLE_PERMISSIONS: dict[UserRole, frozenset[Permission]] = {
    UserRole.superadmin: frozenset(Permission) - {Permission.ASSIGNMENT_TAKE},
    UserRole.org_admin: _ORG_ADMIN_PERMISSIONS,
    UserRole.teacher: _TEACHER_PERMISSIONS,
    UserRole.student: frozenset({Permission.ASSIGNMENT_TAKE}),
}


def coerce_role(role: UserRole | str) -> UserRole:
    if isinstance(role, UserRole):
        return role
    mapped = _LEGACY_ROLE_MAP.get(role)
    if mapped:
        return mapped
    return UserRole(role)


def permissions_for_role(role: UserRole | str) -> list[str]:
    resolved = coerce_role(role)
    return sorted(item.value for item in ROLE_PERMISSIONS.get(resolved, frozenset()))


def has_permission(role: UserRole | str, *codes: str | Permission) -> bool:
    resolved = coerce_role(role)
    allowed = ROLE_PERMISSIONS.get(resolved, frozenset())
    return all((code if isinstance(code, Permission) else Permission(code)) in allowed for code in codes)


def serialize_user(user) -> dict:
    role = coerce_role(user.role)
    raw_name = getattr(user, "display_name", None)
    display_name = (raw_name or "").strip() or None
    organization_id = getattr(user, "organization_id", None)
    organization = getattr(user, "organization", None)
    organization_name = organization.name if organization is not None else None
    return {
        "id": user.id,
        "username": user.username,
        "display_name": display_name,
        "role": role,
        "is_active": user.is_active,
        "avatar_url": getattr(user, "avatar_url", None),
        "organization_id": organization_id,
        "organization_name": organization_name,
        "permissions": permissions_for_role(role),
    }


def creatable_roles(actor_role: UserRole | str) -> list[UserRole]:
    resolved = coerce_role(actor_role)
    if resolved == UserRole.superadmin:
        return [UserRole.superadmin, UserRole.org_admin]
    if resolved == UserRole.org_admin:
        return [UserRole.teacher, UserRole.student]
    if resolved == UserRole.teacher:
        return [UserRole.student]
    return []


def can_delete_role(actor_role: UserRole | str, target_role: UserRole | str) -> bool:
    return coerce_role(target_role) in creatable_roles(actor_role)


def is_superadmin(role: UserRole | str) -> bool:
    return coerce_role(role) == UserRole.superadmin


def is_org_admin(role: UserRole | str) -> bool:
    return coerce_role(role) == UserRole.org_admin


def same_organization(actor, target) -> bool:
    left = getattr(actor, "organization_id", None)
    right = getattr(target, "organization_id", None)
    return left is not None and left == right


def is_org_staff(role: UserRole | str) -> bool:
    return coerce_role(role) in {UserRole.org_admin, UserRole.teacher}


def can_access_managed_user(actor, target) -> bool:
    if is_superadmin(actor.role):
        return True
    if coerce_role(target.role) == UserRole.superadmin:
        return False
    if is_org_admin(actor.role):
        return same_organization(actor, target)
    return (
        coerce_role(target.role) == UserRole.student
        and getattr(target, "teacher_id", None) == actor.id
    )


def can_access_wrong_question(actor, question) -> bool:
    if question is None:
        return False
    if is_superadmin(actor.role):
        return True
    if question.created_by == actor.id:
        return True
    actor_org = getattr(actor, "organization_id", None)
    if actor_org and getattr(question, "organization_id", None) == actor_org:
        return True
    return bool(getattr(question, "is_public", False))


def can_edit_wrong_question(actor, question) -> bool:
    if question is None:
        return False
    if is_superadmin(actor.role):
        return True
    if question.created_by == actor.id:
        return True
    return bool(
        is_org_admin(actor.role)
        and getattr(actor, "organization_id", None)
        and getattr(question, "organization_id", None) == actor.organization_id
    )


def can_access_assignment(actor, assignment) -> bool:
    if assignment is None:
        return False
    if is_superadmin(actor.role):
        return True
    return assignment.created_by == actor.id


def can_reset_user_password(actor, target) -> bool:
    if actor is None or target is None or actor.id == target.id:
        return False
    if is_superadmin(actor.role):
        return coerce_role(target.role) in {UserRole.superadmin, UserRole.org_admin}
    if is_org_admin(actor.role):
        return same_organization(actor, target) and coerce_role(target.role) in {
            UserRole.teacher,
            UserRole.student,
        }
    return False
