import { definePage } from '../src';

const data = (file: string) => `examples/${file}`;

export const athletes = definePage({
  id: 'athletes',
  path: '/athletes/',
  title: 'Olympic Athlete Explorer',
  data: { athletes: data('vgplot-gallery/public/data/athletes.csv') },
});

export const cars = definePage({
  id: 'cars',
  path: '/cars-parcoords/',
  title: 'Cars Parallel Coordinates',
  data: { cars: data('cars-parallel-coords/public/data/cars.csv') },
});

export const dashboard = definePage({
  id: 'dashboard',
  path: '/react-dashboard/',
  title: 'React Dashboard',
});

export const airports = definePage({
  id: 'airports',
  path: '/vega-lite/#airports',
  title: 'Vega-Lite: U.S. airports',
  data: {
    flights: data('vega-lite-gallery/public/data/flights-airport.csv'),
    airports: data('vega-lite-gallery/public/data/airports.csv'),
  },
});

export const weather = definePage({
  id: 'weather',
  path: '/vega-lite/#seattle-weather',
  title: 'Vega-Lite: Seattle weather',
  data: { weather: data('vega-lite-gallery/public/data/seattle-weather.csv') },
});

export const development = definePage({
  id: 'development',
  path: '/vega-lite/#global-development',
  title: 'Vega-Lite: global development',
  data: { gapminder: data('vega-lite-gallery/public/data/gapminder.json') },
});

export const aeromagnetic = definePage({
  id: 'aeromagnetic',
  path: '/vgplot/#aeromagnetic-survey',
  title: 'VGPlot: aeromagnetic survey',
  data: { survey: data('vgplot-gallery/public/data/ca55-south.parquet') },
});

export const flights = definePage({
  id: 'flights',
  path: '/vgplot/#flights-200k',
  title: 'VGPlot: 200k flights crossfilter',
  data: { flights: data('vgplot-gallery/public/data/flights-200k.parquet') },
});
