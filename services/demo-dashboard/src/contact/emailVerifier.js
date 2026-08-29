import { emailService } from '../platform/EmailService.js';

export function isValidEmailSyntax(value) {
  return emailService.isValidSyntax(value);
}

export async function verifyObservedEmail(value, options = {}) {
  return emailService.verifyObserved(value, options);
}
