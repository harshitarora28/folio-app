const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// Redirect react-dom to react-native — needed because @clerk/clerk-react
// imports react-dom internally, which doesn't exist in React Native
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'react-dom': require.resolve('react-native'),
}

module.exports = config