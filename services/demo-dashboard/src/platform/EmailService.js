import validator from 'validator';
import { resolveMx } from 'node:dns/promises';

const EMAIL_OPTIONS = Object.freeze({
  allow_display_name: false,
  allow_utf8_local_part: false,
  allow_ip_domain: false,
  require_tld: true,
  ignore_max_length: false
});

export class EmailService {
  normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  isValidSyntax(value) {
    const email = String(value || '').trim();
    return validator.isEmail(email, { ...EMAIL_OPTIONS });
  }

  async verifyObserved(value, { resolveMxImpl = resolveMx } = {}) {
    const email = this.normalize(value);
    if (!this.isValidSyntax(email)) {
      return {
        verification_status: 'INVALID', verification_method: 'public_page+syntax',
        syntax_valid: false, mx_present: false
      };
    }
    const domain = email.slice(email.lastIndexOf('@') + 1);
    try {
      const records = await resolveMxImpl(domain);
      const mxPresent = Array.isArray(records) && records.length > 0;
      return {
        verification_status: mxPresent ? 'DOMAIN_MX_VERIFIED' : 'PUBLICLY_OBSERVED',
        verification_method: mxPresent ? 'public_page+syntax+dns_mx' : 'public_page+syntax+dns_mx_none',
        syntax_valid: true, mx_present: mxPresent
      };
    } catch {
      return {
        verification_status: 'PUBLICLY_OBSERVED', verification_method: 'public_page+syntax+dns_mx_unavailable',
        syntax_valid: true, mx_present: false
      };
    }
  }
}

export const emailService = new EmailService();
