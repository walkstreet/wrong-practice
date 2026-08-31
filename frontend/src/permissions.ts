import type { UserRole } from "./types";

export const Permission = {
  QUESTION_VIEW: "question.view",
  QUESTION_CREATE: "question.create",
  QUESTION_EDIT: "question.edit",
  QUESTION_DELETE: "question.delete",
  QUESTION_RESTORE: "question.restore",
  QUESTION_ANALYZE: "question.analyze",
  TAXONOMY_VIEW: "taxonomy.view",
  TAXONOMY_MANAGE: "taxonomy.manage",
  ASSIGNMENT_MANAGE: "assignment.manage",
  ASSIGNMENT_REVIEW: "assignment.review",
  ASSIGNMENT_TAKE: "assignment.take",
  PRACTICE_VIEW: "practice.view",
  USER_VIEW: "user.view",
  USER_CREATE: "user.create",
  USER_MANAGE: "user.manage",
  SYSTEM_VIEW: "system.view",
  AUDIT_VIEW: "audit.view",
} as const;

export type PermissionCode = (typeof Permission)[keyof typeof Permission];

export const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: "超管",
  org_admin: "机构管理员",
  teacher: "教师",
  student: "学生",
};

export function can(permissions: string[] | undefined, code: string): boolean {
  return Boolean(permissions?.includes(code));
}

export function canDeleteRole(actorRole: UserRole | null, targetRole: UserRole): boolean {
  return creatableRoles(actorRole).includes(targetRole);
}

export function creatableRoles(actorRole: UserRole | null): UserRole[] {
  if (actorRole === "superadmin") return ["superadmin", "org_admin"];
  if (actorRole === "org_admin") return ["teacher", "student"];
  if (actorRole === "teacher") return ["student"];
  return [];
}

export function canResetUserPassword(actorRole: UserRole | null, targetRole: UserRole, isSelf: boolean): boolean {
  if (isSelf) return false;
  if (actorRole === "superadmin") return targetRole === "superadmin" || targetRole === "org_admin";
  if (actorRole === "org_admin") return targetRole === "teacher" || targetRole === "student";
  return false;
}

export function isOrgStaffRole(role: UserRole | null): boolean {
  return role === "org_admin" || role === "teacher";
}

export function canManageWrongQuestion(
  role: UserRole | null,
  userId: number | null,
  question: { created_by?: number | null; organization_id?: number | null },
  organizationId?: number | null,
): boolean {
  if (role === "superadmin") return true;
  if (userId != null && question.created_by === userId) return true;
  return (
    role === "org_admin" &&
    organizationId != null &&
    question.organization_id === organizationId
  );
}

export function defaultHomePath(permissions: string[]): string {
  if (can(permissions, Permission.QUESTION_VIEW)) return "/wrong-questions";
  if (can(permissions, Permission.ASSIGNMENT_TAKE)) return "/my-assignments";
  if (can(permissions, Permission.ASSIGNMENT_REVIEW)) return "/admin-assignments";
  return "/login";
}
