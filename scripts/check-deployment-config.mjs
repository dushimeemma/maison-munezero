import { deploymentConfig } from './ci-config.mjs';
deploymentConfig(process.env);
console.log('Deployment variables and credentials are present. No secret values printed.');
