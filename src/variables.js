/**
 * Derive a first name from an email address.
 * Splits local part on '.', capitalizes first segment.
 * e.g. "bob.smith@example.com" -> "Bob"
 * e.g. "alice@example.com" -> "Alice"
 */
export function deriveFirstName(email) {
  if (!email || !email.includes('@')) return '';
  const local = email.split('@')[0];
  const first = local.split('.')[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/**
 * Substitute {{variables}} and {{spin|syntax|options}} in a string.
 *
 * Two patterns supported inside {{ }}:
 *   {{variableName}}         — replaced with the variable value (built-in or custom)
 *   {{option1|option2|...}}  — one option picked at random (spintax)
 *
 * Built-in variables: firstName, recipient, subject, originalBody, daysSince, stepNumber.
 * Custom variables from the `variables` object override built-ins.
 * Unknown single-word variables are left as-is so misconfiguration is visible.
 */
export function substituteVariables(text, context) {
  const { recipient, subject, originalBody, createdAt, stepIndex, variables } = context;

  const daysSince = createdAt
    ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000)
    : 0;

  const builtIns = {
    firstName: deriveFirstName(recipient),
    recipient: recipient || '',
    subject: subject || '',
    originalBody: originalBody || '',
    daysSince: String(daysSince),
    stepNumber: String((stepIndex || 0) + 1),
  };

  const merged = { ...builtIns, ...variables };

  // Match anything inside {{ }} — handles both variables and spintax
  return text.replace(/\{\{([^}]+)\}\}/g, (match, inner) => {
    // Spintax: contains pipe character → pick a random option
    if (inner.includes('|')) {
      const options = inner.split('|');
      return options[Math.floor(Math.random() * options.length)].trim();
    }
    // Variable: single word → look up in merged variables
    const key = inner.trim();
    return key in merged ? merged[key] : match;
  });
}
