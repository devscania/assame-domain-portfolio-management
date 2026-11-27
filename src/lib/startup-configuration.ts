import { validateRuntimeConfig } from './runtime-config';

/** Node-only startup hook, dynamically imported outside the Edge bundle. */
export function validateStartupConfiguration() {
  try {
    validateRuntimeConfig(process.env);
  } catch {
    // Next can retain a listening server after an instrumentation error. Exit so
    // the process supervisor sees failed startup instead of an endless HTTP 500.
    console.error('Application startup configuration is invalid. Review the required deployment settings.');
    process.exit(1);
  }
}
