// Metro config.
//
// The conversational lift diagnostic's stage machine, accessory policy,
// grading and copy live in ../packages/diagnostic-core so the web app
// (frontend-v2) runs the exact same logic. Metro only watches the project
// root by default, so the package is added as a watch folder and mapped to
// its import name. It ships as TypeScript source with no dependencies.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const corePath = path.resolve(__dirname, '../packages/diagnostic-core');
const agentUiCorePath = path.resolve(__dirname, '../packages/agent-ui-core');
const personalTrainingCorePath = path.resolve(__dirname, '../packages/personal-training-core');

config.watchFolders = [...(config.watchFolders ?? []), corePath, agentUiCorePath, personalTrainingCorePath];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@axiom/diagnostic-core': corePath,
  '@axiom/agent-ui-core': agentUiCorePath,
  '@axiom/personal-training-core': personalTrainingCorePath,
};

module.exports = config;
