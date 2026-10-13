export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  // Drizzle wraps the PostgreSQL error in a query error's cause.
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    if (
      'code' in current && current.code === '23505' &&
      'constraint' in current && current.constraint === constraint
    ) {
      return true;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
