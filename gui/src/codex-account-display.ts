import type { TFn } from "./i18n/shared";

export interface CodexAccountDisplayIdentity {
  id: string;
  isMain?: boolean;
  alias?: string;
  email?: string;
}

/**
 * One stable account name for cards, confirmation dialogs and feedback.
 * Empty aliases must not hide a valid email, and opaque storage ids are never
 * exposed as a UI fallback.
 */
export function codexAccountDisplayLabel<T extends CodexAccountDisplayIdentity>(
  accounts: readonly T[],
  account: CodexAccountDisplayIdentity,
  t: TFn,
): string {
  const alias = account.alias?.trim();
  if (alias) return alias;

  const email = account.email?.trim();
  if (email) return email;

  if (account.isMain || account.id === "__main__") return t("codexAuth.mainAccount");

  const index = accounts.findIndex(candidate => candidate.id === account.id);
  return t("pws.accountOrdinal", { count: String(index >= 0 ? index + 1 : 1) });
}
