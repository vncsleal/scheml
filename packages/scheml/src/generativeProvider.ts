import { ConfigurationError } from './errors';

function isConfiguredProvider(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function requireGenerativeProvider(
  traitName: string,
  configuredProvider?: unknown,
  overrideProvider?: unknown
): unknown {
  const provider = isConfiguredProvider(overrideProvider)
    ? overrideProvider
    : configuredProvider;

  if (!isConfiguredProvider(provider)) {
    throw new ConfigurationError(
      `Trait "${traitName}" requires a configured generative provider. ` +
        'Set defineConfig({ generativeProvider: ... }) or pass a provider override at runtime.'
    );
  }

  return provider;
}