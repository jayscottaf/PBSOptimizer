/**
 * Normalize aircraft type to base code, stripping position suffix (A/B with
 * or without hyphen). Bid packages say "A220" while Reasons Reports say
 * "220-B" — matching them requires comparing base types, not raw strings.
 * Examples:
 *   A220, 220-A, 220-B, 220A, 220B -> 220
 *   73H, 73H-A, 73H-B, 73HA, 73HB -> 73H
 *   CR9, CR9-B, CR9A -> CR9
 *   CS1-A, CS1B -> CS1
 * Position: A = Captain, B = First Officer
 */
export const parseAircraftCode = (
  aircraft: string
): { baseType: string; position: string | null } => {
  // Remove ALL whitespace (not just trim) to handle "220 B" vs "220B" variations
  const normalized = aircraft.toUpperCase().replace(/\s+/g, '');

  // Pattern 1: Any base code with position suffix (with or without hyphen)
  // Match: alphanumeric base + optional hyphen + A or B at end
  // Examples: "220-A", "220A", "73H-B", "73HB", "CR9A"
  const suffixMatch = normalized.match(/^([A-Z0-9]+?)-?([AB])$/);
  if (suffixMatch) {
    let baseType = suffixMatch[1];
    const position = suffixMatch[2];

    // If base is purely numeric with letter prefix like "A220", strip the prefix
    const prefixNumeric = baseType.match(/^[A-Z](\d{3})$/);
    if (prefixNumeric) {
      baseType = prefixNumeric[1];
    }
    return { baseType, position };
  }

  // Pattern 2: Letter prefix like "A220" or "A350" (no position suffix)
  const prefixMatch = normalized.match(/^[A-Z](\d{3})$/);
  if (prefixMatch) {
    return { baseType: prefixMatch[1], position: null };
  }

  // Pattern 3: Any alphanumeric code without position suffix (e.g., "73H", "CR9", "220")
  // Return as-is since there's no position suffix to strip
  return { baseType: normalized, position: null };
};
