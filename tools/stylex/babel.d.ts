// The Babel 7 syntax plugins ship without declarations; both export a plugin factory.
declare module '@babel/plugin-syntax-jsx' {
  import type { PluginObj } from '@babel/core';
  const plugin: () => PluginObj;
  export default plugin;
}
declare module '@babel/plugin-syntax-typescript' {
  import type { PluginObj } from '@babel/core';
  const plugin: () => PluginObj;
  export default plugin;
}
