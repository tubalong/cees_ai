import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './openapi/ai-service.openapi.yaml',
  output: '../ai-service-client/src/generated',
  plugins: [
    '@hey-api/typescript',
    '@hey-api/sdk',
    {
      name: '@hey-api/client-fetch',
      runtimeConfigPath: '../ai-service-client/src/runtime-config.ts',
    },
  ],
});
