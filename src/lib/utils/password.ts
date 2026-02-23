import * as m from "$paraglide/messages.js";

/**
 * Validates the strength of a password.
 * Requirements:
 * - At least 8 characters long
 * - At least one lowercase letter
 * - At least one uppercase letter
 * - At least one number
 * - At least one special character
 *
 * @param password The password to validate
 * @returns An error message string if invalid, or null if valid.
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return m.err_password_length();
  }
  if (!/[a-z]/.test(password)) {
    return m.err_password_lowercase();
  }
  if (!/[A-Z]/.test(password)) {
    return m.err_password_uppercase();
  }
  if (!/[0-9]/.test(password)) {
    return m.err_password_number();
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return m.err_password_special();
  }
  return null;
}
