export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return '/portfolio';
  return /^\/(?:login|register)(?:[/?#]|$)/.test(value) ? '/portfolio' : value;
}
export type CredentialValidationKey = 'auth.validation.email' | 'auth.validation.password' | 'auth.validation.confirm';
export function validateCredentials(email: string, password: string, confirmPassword?: string): CredentialValidationKey | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 320) return 'auth.validation.email';
  if (password.length < 8 || new TextEncoder().encode(password).length > 72) return 'auth.validation.password';
  if (confirmPassword !== undefined && password !== confirmPassword) return 'auth.validation.confirm';
  return null;
}
