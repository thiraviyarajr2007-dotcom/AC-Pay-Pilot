import fs from 'node:fs';

export class ConfigurationError extends Error {
  missingVars: string[];
  constructor(message: string, missingVars: string[]) {
    super(message);
    this.name = 'ConfigurationError';
    this.missingVars = missingVars;
  }
}

export interface ConfigValidationResult {
  ok: boolean;
  missing: string[];
  warnings: string[];
  persistenceMode: 'firestore-admin' | 'memory-volatile';
}

/**
 * Validates startup environment configuration.
 * - In production, strictly requires PAYPAL_WEBHOOK_ID, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
 *   and usable Google Cloud credentials (via GOOGLE_APPLICATION_CREDENTIALS file or GCP ADC). Throws if any is missing.
 * - Lists every missing environment variable by name; NEVER prints secret values.
 * - Asserts at boot that test-signature bypass is unreachable when NODE_ENV !== 'test'.
 */
export function validateStartupConfig(env: NodeJS.ProcessEnv = process.env): ConfigValidationResult {
  const isProduction = env.NODE_ENV === 'production';
  const isTest = env.NODE_ENV === 'test';
  const missing: string[] = [];
  const warnings: string[] = [];

  const hasInlineServiceAccount = [
    'FIREBASE_SERVICE_ACCOUNT',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  ].some((envName) => {
    try {
      const parsed = JSON.parse(env[envName] || '');
      return Boolean(parsed?.client_email && parsed?.private_key);
    } catch {
      return false;
    }
  });

  const requiredInProd = [
    'PAYPAL_WEBHOOK_ID',
    'PAYPAL_CLIENT_ID',
    'PAYPAL_CLIENT_SECRET',
  ];

  if (isProduction) {
    for (const vName of requiredInProd) {
      const val = env[vName];
      if (!val || val.trim() === '' || val.startsWith('MY_') || val.startsWith('sb-placeholder')) {
        missing.push(vName);
      }
    }

    // Validate Google Cloud credentials:
    // Support inline service-account JSON (Vercel/secret managers), GOOGLE_APPLICATION_CREDENTIALS file,
    // or Application Default Credentials on Google Cloud hosting platforms (Cloud Run K_SERVICE, App Engine GAE_SERVICE).
    const isGoogleCloudHosted = Boolean(env.K_SERVICE || env.GAE_SERVICE);
    const gcpCredPath = env.GOOGLE_APPLICATION_CREDENTIALS;

    if (hasInlineServiceAccount || isGoogleCloudHosted) {
      // Durable Admin credentials are available without a local credential file.
    } else if (!gcpCredPath) {
      missing.push('GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT');
    } else {
      if (gcpCredPath.trim() === '' || gcpCredPath.startsWith('MY_') || gcpCredPath.startsWith('sb-placeholder')) {
        missing.push('GOOGLE_APPLICATION_CREDENTIALS');
      } else {
        // Validate that credential file exists and is accessible
        try {
          if (!fs.existsSync(gcpCredPath)) {
            missing.push('GOOGLE_APPLICATION_CREDENTIALS');
            warnings.push(`Configured GOOGLE_APPLICATION_CREDENTIALS file not found: '${gcpCredPath}'`);
          }
        } catch (err: any) {
          missing.push('GOOGLE_APPLICATION_CREDENTIALS');
          warnings.push(`Cannot access GOOGLE_APPLICATION_CREDENTIALS file '${gcpCredPath}': ${err.message}`);
        }
      }
    }
  }

  // Security invariant: Test signature bypass is unreachable when NODE_ENV !== 'test'
  if (!isTest) {
    if (env.ALLOW_TEST_SIGNATURE_BYPASS === 'true') {
      throw new ConfigurationError(
        'SECURITY VIOLATION: Test webhook bypass is enabled outside test environment.',
        ['NODE_ENV']
      );
    }
  }

  let credFileExists = false;
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      credFileExists = fs.existsSync(env.GOOGLE_APPLICATION_CREDENTIALS);
    } catch {
      credFileExists = false;
    }
  }

  const hasGcpCreds =
    hasInlineServiceAccount ||
    credFileExists ||
    Boolean(env.K_SERVICE) ||
    Boolean(env.GAE_SERVICE);
  const persistenceMode = hasGcpCreds ? 'firestore-admin' : 'memory-volatile';

  if (isProduction && missing.length > 0) {
    throw new ConfigurationError(
      `FATAL STARTUP ERROR: Missing or invalid required production environment variables: [${missing.join(', ')}]. All production deployments must configure these variables.`,
      missing
    );
  }

  if (!isProduction && !isTest) {
    for (const vName of requiredInProd) {
      const val = env[vName];
      if (!val || val.trim() === '' || val.startsWith('MY_')) {
        warnings.push(`Missing ${vName} (using dev/test sandbox fallback)`);
      }
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    warnings,
    persistenceMode,
  };
}
