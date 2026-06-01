// expo-router's babel plugin ships inside babel-preset-expo (SDK 50+), so no
// extra plugin entry is needed here.
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
  }
}
