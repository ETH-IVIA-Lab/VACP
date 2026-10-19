/** Every example mounts into a target and resolves to the function that unmounts it. */
type ExampleModule = {
  mount(target: HTMLElement): Promise<() => void | Promise<void>>;
};

type ExampleEntry = {
  id: string;
  route: string;
  title: string;
  description: string;
  folder: string;
  layout?: 'document';
  load(): Promise<ExampleModule>;
};

export const examples: readonly ExampleEntry[] = [
  {
    id: 'athletes',
    route: 'athletes',
    title: 'Olympic Athlete Explorer',
    description: 'Rio 2016 athletes: height and weight, age, and medal share by sport.',
    folder: 'athlete-explorer',
    layout: 'document',
    load: () => import('@ethivia/vacp-example-athlete-explorer'),
  },
  {
    id: 'vgplot',
    route: 'vgplot',
    title: 'VGPlot Gallery',
    description: 'Flights, taxi rides, weather, earthquakes, and more in linked vgplot views.',
    folder: 'vgplot-gallery',
    load: () => import('@ethivia/vacp-example-vgplot-gallery'),
  },
  {
    id: 'vega-lite',
    route: 'vega-lite',
    title: 'Vega-Lite Gallery',
    description: 'U.S. airports, global development, and Seattle weather with live selections.',
    folder: 'vega-lite-gallery',
    load: () => import('@ethivia/vacp-example-vega-lite-gallery'),
  },
  {
    id: 'react-dashboard',
    route: 'react-dashboard',
    title: 'React Dashboard',
    description: 'Scatter, distributions, and rows for the Iris and Motor Trend datasets.',
    folder: 'react-dashboard',
    load: () => import('@ethivia/vacp-example-react-dashboard'),
  },
  {
    id: 'cars-parcoords',
    route: 'cars-parcoords',
    title: 'Cars Parallel Coordinates',
    description: '392 cars from 1970 to 1982 across seven performance dimensions.',
    folder: 'cars-parallel-coords',
    load: () => import('@ethivia/vacp-example-cars-parallel-coords'),
  },
];
