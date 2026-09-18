type ExampleModule = {
  mount(target: HTMLElement): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
};

type ExampleEntry = {
  id: string;
  route: string;
  title: string;
  description: string;
  folder: string;
  load(): Promise<ExampleModule>;
};

export const examples: readonly ExampleEntry[] = [
  {
    id: 'vgplot',
    route: 'vgplot',
    title: 'VGPlot Gallery',
    description: 'Spec-driven examples with rich interactions powered by VGPlot.',
    folder: 'vgplot-gallery',
    load: () => import('@vacp/example-vgplot-gallery'),
  },
  {
    id: 'vega-lite',
    route: 'vega-lite',
    title: 'Vega-Lite Gallery',
    description: 'Declarative Vega-Lite visualizations with parameter and selection controls.',
    folder: 'vega-lite-gallery',
    load: () => import('@vacp/example-vega-lite-gallery'),
  },
  {
    id: 'react-dashboard',
    route: 'react-dashboard',
    title: 'React Dashboard',
    description: 'Linked-view analytics dashboard with brushing, filtering, and table views.',
    folder: 'react-dashboard',
    load: () => import('@vacp/example-react-dashboard'),
  },
  {
    id: 'cars-parcoords',
    route: 'cars-parcoords',
    title: 'Cars Parallel Coordinates',
    description: 'Parallel coordinates exploration for multivariate car performance data.',
    folder: 'cars-parallel-coords',
    load: () => import('@vacp/example-cars-parallel-coords'),
  },
];
