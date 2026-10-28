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
 *   and GOOGLE_APPLICATION_CREDENTIALS. Throws if any is missing.
 * - Lists every missing environment variable by name; NEVER prints secret values.
 * - Asserts at boot that test-signature bypass is unreachable when NODE_ENV !== 'test'.
 */
export function validateStartupConfig(env: NodeJS.ProcessEnv = process.env): ConfigValidationResult {
  const isProduction = env.NODE_ENV === 'production';
  const isTest = env.NODE_ENV === 'test';
  const missing: string[] = [];
  const warnings: string[] = [];

  const requiredInProd = [
    'PAYPAL_WEBHOOK_ID',
    'PAYPAL_CLIENT_ID',
    'PAYPAL_CLIENT_SECRET',
    'GOOGLE_APPLICATION_CREDENTIALS',
  ];

  if (isProduction) {
    for (const vName of requiredInProd) {
      const val = env[vName];
      if (!val || val.trim() === '' || val.startsWith('MY_') || val.startsWith('sb-placeholder')) {
        missing.push(vName);
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

  const hasGcpCreds =
    Boolean(env.GOOGLE_APPLICATION_CREDENTIALS) ||
    Boolean(env.K_SERVICE) ||
    Boolean(env.GAE_SERVICE);
  const persistenceMode = hasGcpCreds ? 'firestore-admin' : 'memory-volatile';

  if (isProduction && missing.length > 0) {
    throw new ConfigurationError(
      `FATAL STARTUP ERROR: Missing required production environment variables: [${missing.join(', ')}]. All production deployments must configure these variables.`,
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
