// biome-ignore-all lint/complexity/noThisInStatic: vendored — keep byte-identical to the canonical apexcharts-shared source.
// VENDORED — interim copy of the canonical ApexCharts LicenseManager (used by
// apexgantt / apextree / apexsankey). It is duplicated here to keep the APEX-
// key format identical across products until it is published as the shared
// `apexcharts-shared` package, at which point this file is replaced by an
// import from that package. Do not diverge the key format from the canonical
// source. See plan: Workstream 1.
import { logError } from './logger.js';

interface LicenseData {
  readonly domains?: readonly string[];
  readonly expiryDate: string;
  readonly issueDate: string;
  readonly plan: string;
  readonly valid: boolean;
}

interface LicenseValidationResult {
  readonly data?: LicenseData;
  readonly expired: boolean;
  readonly message?: string;
  readonly valid: boolean;
}

export class LicenseManager {
  private static licenseKey: null | string = null;
  private static validationResult: LicenseValidationResult | null = null;

  /**
   * Decode license data from encoded string.
   * Simple base64 + JSON approach (matches the canonical implementation).
   */
  private static decodeLicenseData(encodedData: string): LicenseData | null {
    try {
      const decodedString = window.atob(encodedData);
      const data = JSON.parse(decodedString);

      if (!data.issueDate || !data.expiryDate || !data.plan) {
        return null;
      }

      return {
        domains: Array.isArray(data.domains) ? data.domains : undefined,
        expiryDate: data.expiryDate,
        issueDate: data.issueDate,
        plan: data.plan,
        valid: true,
      };
    } catch {
      return null;
    }
  }

  /**
   * Generate a license key (for internal/admin use).
   */
  public static generateLicenseKey(
    issueDate: string,
    expiryDate: string,
    plan = 'standard',
    domains?: string[]
  ): string {
    const licenseData: Record<string, unknown> = {
      expiryDate,
      issueDate,
      plan,
    };

    if (domains && domains.length > 0) {
      licenseData.domains = domains;
    }

    const encodedData = window.btoa(JSON.stringify(licenseData));

    return `APEX-${encodedData}`;
  }

  /**
   * Get current license validation result.
   */
  public static getLicenseStatus(): LicenseValidationResult {
    if (!this.licenseKey) {
      return { expired: false, valid: false };
    }

    if (!this.validationResult) {
      this.validationResult = this.validateLicense(this.licenseKey);
    }

    return this.validationResult;
  }

  /**
   * Check if current license is valid.
   */
  public static isLicenseValid(): boolean {
    if (!this.licenseKey) {
      return false;
    }

    if (!this.validationResult) {
      this.validationResult = this.validateLicense(this.licenseKey);
    }

    return this.validationResult.valid;
  }

  /**
   * Set the global license key.
   */
  public static setLicense(key: string): void {
    this.licenseKey = key;
    this.validationResult = this.validateLicense(key);

    if (!this.validationResult.valid) {
      logError(`[Apex] ${this.validationResult.message}`);
    }
  }

  /**
   * Validate license key format and content.
   */
  private static validateLicense(key: string): LicenseValidationResult {
    try {
      if (!key.startsWith('APEX-')) {
        return {
          expired: false,
          message: 'Invalid license key format. License key must start with "APEX-".',
          valid: false,
        };
      }

      const separatorIndex = key.indexOf('-');
      const encodedData = separatorIndex !== -1 ? key.slice(separatorIndex + 1) : '';

      if (!encodedData) {
        return {
          expired: false,
          message: 'Invalid license key format. Expected format: APEX-{encoded-data}.',
          valid: false,
        };
      }
      const licenseData = this.decodeLicenseData(encodedData);

      if (!licenseData) {
        return {
          expired: false,
          message: 'Invalid license key. Unable to decode license data.',
          valid: false,
        };
      }

      const now = new Date();
      const expiryDate = new Date(licenseData.expiryDate);

      if (expiryDate < now) {
        return {
          data: licenseData,
          expired: true,
          message: `License expired on ${licenseData.expiryDate}. Please renew your license.`,
          valid: false,
        };
      }

      if (licenseData.domains && licenseData.domains.length > 0) {
        const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';
        const isDomainAllowed = licenseData.domains.some(
          (domain) => currentHostname === domain || currentHostname.endsWith(`.${domain}`)
        );

        if (!isDomainAllowed) {
          return {
            data: licenseData,
            expired: false,
            message: `License is not valid for this domain (${currentHostname}). Allowed domains: ${licenseData.domains.join(', ')}.`,
            valid: false,
          };
        }
      }

      return {
        data: licenseData,
        expired: false,
        valid: true,
      };
    } catch {
      return {
        expired: false,
        message: 'Invalid license key format or corrupted data.',
        valid: false,
      };
    }
  }
}
