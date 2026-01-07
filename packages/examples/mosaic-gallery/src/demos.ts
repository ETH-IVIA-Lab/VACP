import type { VacpDemo } from '@vacp/core';

import type { GalleryEntry } from './gallery';

export function buildDemos(entry: GalleryEntry): VacpDemo[] {
  const viewBase = `vacp://vacp-examples/mosaic/${entry.id}`;

  if (entry.id === 'wnba-shots') {
    return [
      {
        id: `${entry.id}-menus`,
        title: 'Bidirectional filtering',
        description:
          'Uses the same semantic menu operations an agent can call. Then compare with manual menu interaction and time travel the history.',
        steps: [
          {
            title: 'Pick a team (first non-All option)',
            call: { name: 'mosaic.set_input_option_index', params: { ref: `${viewBase}/input/0`, index: 1 } },
          },
          {
            title: 'Pick an athlete (first non-All option)',
            description: 'The Athlete menu is filtered by the selected team.',
            call: { name: 'mosaic.set_input_option_index', params: { ref: `${viewBase}/input/1`, index: 1 } },
          },
          {
            title: 'Clear athlete filter',
            call: { name: 'mosaic.clear_input', params: { ref: `${viewBase}/input/1` } },
          },
          { title: 'Clear team filter', call: { name: 'mosaic.clear_input', params: { ref: `${viewBase}/input/0` } } },
        ],
      },
    ];
  }

  if (entry.id === 'weather') {
    return [
      {
        id: `${entry.id}-linked`,
        title: 'Linked views (brush + toggle)',
        description:
          'Brush the top plot or toggle categories in the bottom plot: both human and agent actions update the same VACP state graph.',
        steps: [
          {
            title: 'Set brush range',
            call: { name: 'mosaic.set_interval_1d', params: { plotId: 'plot-0', interactorId: '0', min: 5, max: 20 } },
          },
          {
            title: 'Toggle “rain” in bars',
            call: { name: 'mosaic.set_toggle', params: { plotId: 'plot-1', interactorId: '0', value: 'rain' } },
          },
          {
            title: 'Clear toggle',
            call: { name: 'mosaic.clear_toggle', params: { plotId: 'plot-1', interactorId: '0' } },
          },
          {
            title: 'Clear brush',
            call: { name: 'mosaic.clear_interval_1d', params: { plotId: 'plot-0', interactorId: '0' } },
          },
        ],
      },
    ];
  }

  const is1d = entry.id === 'crossfilter';
  const interactorId = '0';
  const steps: VacpDemo['steps'] = is1d
    ? [
        {
          title: 'Clear brush',
          description: 'Reset the interval selection.',
          call: { name: 'mosaic.clear_interval_1d', params: { interactorId } },
        },
        {
          title: 'Set brush (narrow)',
          description: 'Apply a small interval in domain units.',
          call: { name: 'mosaic.set_interval_1d', params: { interactorId, min: -10, max: 10 } },
        },
        {
          title: 'Set brush (wide)',
          description: 'Move/resize the interval to see linked views update.',
          call: { name: 'mosaic.set_interval_1d', params: { interactorId, min: -25, max: 70 } },
        },
        { title: 'Clear brush again', call: { name: 'mosaic.clear_interval_1d', params: { interactorId } } },
      ]
    : [
        {
          title: 'Clear brush',
          description: 'Reset the 2D interval selection.',
          call: { name: 'mosaic.clear_interval_2d', params: { interactorId } },
        },
        {
          title: 'Set brush (small box)',
          description: 'Apply a small x/y box in domain units.',
          call: { name: 'mosaic.set_interval_2d', params: { interactorId, x0: 30, x1: 60, y0: 30, y1: 60 } },
        },
        {
          title: 'Set brush (different box)',
          call: { name: 'mosaic.set_interval_2d', params: { interactorId, x0: 10, x1: 40, y0: 50, y1: 90 } },
        },
        { title: 'Clear brush again', call: { name: 'mosaic.clear_interval_2d', params: { interactorId } } },
      ];

  return [
    {
      id: `${entry.id}-brush`,
      title: 'Bidirectional selection',
      description:
        'Runs the same selection operations an agent would, then you can compare with human brushing and time-travel the history.',
      steps,
    },
  ];
}
