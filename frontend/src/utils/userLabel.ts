export function userLabel(user: { display_name?: string | null; username: string }): string {
  const name = user.display_name?.trim();
  return name || user.username;
}

export function userOptionLabel(user: { display_name?: string | null; username: string }): string {
  const name = user.display_name?.trim();
  if (name && name !== user.username) return `${name}（${user.username}）`;
  return user.username;
}
