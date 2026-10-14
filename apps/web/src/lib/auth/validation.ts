export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return '/portfolio';
  return /^\/(?:login|register)(?:[/?#]|$)/.test(value) ? '/portfolio' : value;
}
export function validateCredentials(email: string, password: string, confirmPassword?: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 320) return 'Enter a valid email address.';
  if (password.length < 8 || new TextEncoder().encode(password).length > 72) return 'Password must contain at least 8 characters and fit within 72 UTF-8 bytes.';
  if (confirmPassword !== undefined && password !== confirmPassword) return 'Passwords do not match.';
  return null;
}
