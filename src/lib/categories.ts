/** Fixed login categories. Admin grants per-user access to these. */
export const CATEGORIES = ["work", "personal", "finance", "social", "other"] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  work: "Work",
  personal: "Personal",
  finance: "Finance",
  social: "Social",
  other: "Other",
};

export const ALL_CATEGORIES_CSV = CATEGORIES.join(",");

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

export function parseCategories(csv: string | null | undefined): Category[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(isCategory);
}

export function categoriesToCsv(list: readonly string[]): string {
  return parseCategories(list.join(",")).join(",");
}

/** Owners and platform superadmins always see every category. */
export function effectiveCategories(
  role: string,
  allowedCsv: string,
  opts?: { orgRole?: string | null; platformRole?: string },
): Category[] {
  if (opts?.platformRole === "superadmin") return [...CATEGORIES];
  if (role === "admin" || opts?.orgRole === "owner") return [...CATEGORIES];
  return parseCategories(allowedCsv);
}

export function canAccessCategory(
  role: string,
  allowedCsv: string,
  category: string,
  opts?: { orgRole?: string | null; platformRole?: string },
): boolean {
  return effectiveCategories(role, allowedCsv, opts).includes(category as Category);
}
