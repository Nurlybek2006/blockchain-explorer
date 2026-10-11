export function jsonSafe(
  value: unknown,
): unknown {
  if (
    typeof value ===
    'bigint'
  ) {
    return value.toString();
  }

  if (
    value instanceof
    Date
  ) {
    return value.toISOString();
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return value.map(
      jsonSafe,
    );
  }

  if (
    value !== null &&
    typeof value ===
      'object'
  ) {
    return Object.fromEntries(
      Object.entries(
        value,
      ).map(
        ([
          key,
          child,
        ]) => [
          key,
          jsonSafe(
            child,
          ),
        ],
      ),
    );
  }

  return value;
}
// bigint мәндерін JSON-ға қауіпсіз string түрінде айналдырады.