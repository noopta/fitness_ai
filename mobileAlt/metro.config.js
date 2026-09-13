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

config.watchFolders = [...(config.watchFolders ?? []), corePath];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@axiom/diagnostic-core': corePath,
};

module.exports = config;
