import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import ArchitectureDiagram from './components/ArchitectureDiagram.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ArchitectureDiagram', ArchitectureDiagram);
  },
} satisfies Theme;
