import {
  GetSecretValueCommand,
  SecretsManagerClient,
  SecretsManagerServiceException,
} from '@aws-sdk/client-secrets-manager';
import { getLogger } from '@looopy-ai/core';

export interface LoadSecretsOptions {
  /**
   * List of secret keys to load (e.g., ["/langfuse", "/api-keys"])
   */
  secretKeys: string[];

  /**
   * AWS region for Secrets Manager. Defaults to AWS_REGION env var or "us-west-2"
   */
  awsRegion?: string;

  /**
   * Environment name (dev, staging, prod). Defaults to ENVIRONMENT env var or "dev"
   */
  environment?: string;

  /**
   * Prefix for secret IDs. Defaults to "agents"
   */
  secretPrefix?: string;
}

/**
 * Load secrets from AWS Secrets Manager.
 *
 * The secret values are expected to be JSON and will be parsed.
 * Each key-value pair will be set as an environment variable.
 *
 * Example secret format:
 * ```json
 * {
 *   "LANGFUSE_HOST": "https://...",
 *   "LANGFUSE_PUBLIC_KEY": "***",
 *   "LANGFUSE_SECRET_KEY": "***"
 * }
 * ```
 *
 * @param options - Configuration options for loading secrets
 * @throws {SecretsManagerServiceException} If there's an error accessing AWS Secrets Manager
 */
export async function loadSecrets(options: LoadSecretsOptions): Promise<void> {
  const {
    secretKeys,
    awsRegion = process.env.AWS_REGION || 'us-west-2',
    environment = (process.env.ENVIRONMENT || 'dev').toLowerCase(),
    secretPrefix = 'agents',
  } = options;

  const logger = getLogger({ component: 'secrets-loader' });

  let client: SecretsManagerClient;

  try {
    client = new SecretsManagerClient({ region: awsRegion });
  } catch (error) {
    logger.error(`Failed to create Secrets Manager client: ${error}`);
    return;
  }

  for (const key of secretKeys) {
    const secretId = `${secretPrefix}/${environment}/${key}`;

    try {
      const command = new GetSecretValueCommand({ SecretId: secretId });
      const response = await client.send(command);

      if (!response.SecretString) {
        logger.warn(`Secret ${secretId} has no SecretString`);
        continue;
      }

      const secretData = JSON.parse(response.SecretString) as Record<string, unknown>;

      for (const [envKey, envValue] of Object.entries(secretData)) {
        process.env[envKey] = String(envValue);
        logger.debug(`Loaded secret key: ${envKey}`);
      }

      logger.debug(`Successfully loaded secret: ${secretId}`);
    } catch (error) {
      if (error instanceof SecretsManagerServiceException) {
        if (error.name === 'ResourceNotFoundException') {
          logger.warn(`Secret not found: ${secretId}`);
        } else if (error.name === 'AccessDeniedException') {
          logger.error(`Access denied to secret: ${secretId}`);
        } else {
          logger.error(`Error loading secret ${secretId}: ${error.message}`);
        }
      } else if (error instanceof SyntaxError) {
        logger.error(`Failed to parse secret ${secretId} as JSON: ${error.message}`);
      } else {
        logger.error(`Unexpected error loading secret ${secretId}: ${error}`);
      }
    }
  }
}
