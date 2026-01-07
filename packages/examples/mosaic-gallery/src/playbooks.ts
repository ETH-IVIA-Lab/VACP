import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { GalleryEntry } from './gallery';

type PlaybookBuilder = (entry: GalleryEntry, viewBase: string) => VacpPlaybook[];

function anySpecNode(obj: unknown, pred: (node: Record<string, unknown>) => boolean): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some((v) => anySpecNode(v, pred));
  const rec = obj as Record<string, unknown>;
  if (pred(rec)) return true;
  return Object.values(rec).some((v) => anySpecNode(v, pred));
}

function specHasInput(entry: GalleryEntry): boolean {
  return anySpecNode(entry.spec, (n) => typeof n.input === 'string');
}

function specHasInterval1D(entry: GalleryEntry): boolean {
  return anySpecNode(entry.spec, (n) => n.select === 'intervalX' || n.select === 'intervalY');
}

function specHasInterval2D(entry: GalleryEntry): boolean {
  return anySpecNode(entry.spec, (n) => n.select === 'intervalXY');
}

function menuPlaybook(entry: GalleryEntry, viewBase: string): VacpPlaybook[] {
  return [
    playbook({
      id: `${entry.id}-menu`,
      title: 'Bidirectional filtering (menu)',
      description:
        'Uses a first-class Mosaic input so agent actions and human interactions update the same state graph.',
    })
      .action('Pick a non-default option in the first menu', {
        name: 'mosaic.set_input_option_index',
        params: { ref: `${viewBase}/input/0`, index: 1 },
      })
      .action('Clear the menu filter', { name: 'mosaic.clear_input', params: { ref: `${viewBase}/input/0` } })
      .build(),
  ];
}

function intervalPlaybook(entry: GalleryEntry, kind: '1d' | '2d'): VacpPlaybook[] {
  const interactorId = '0';
  const base = playbook({
    id: `${entry.id}-selection`,
    title: 'Bidirectional selection',
    description:
      'Runs the same selection operations an agent would, then you can compare with human interaction and time-travel the history.',
  }).action('Clear brush', {
    name: kind === '1d' ? 'mosaic.clear_interval_1d' : 'mosaic.clear_interval_2d',
    params: { interactorId },
  });

  if (kind === '1d') {
    return [
      base
        .action(
          'Set brush (narrow)',
          { name: 'mosaic.set_interval_1d', params: { interactorId, min: -10, max: 10 } },
          { description: 'Apply a small interval in domain units.' },
        )
        .action(
          'Set brush (wide)',
          { name: 'mosaic.set_interval_1d', params: { interactorId, min: -25, max: 70 } },
          { description: 'Move/resize the interval to see linked views update.' },
        )
        .action('Clear brush again', { name: 'mosaic.clear_interval_1d', params: { interactorId } })
        .build(),
    ];
  }

  return [
    base
      .action(
        'Set brush (small box)',
        { name: 'mosaic.set_interval_2d', params: { interactorId, x0: 30, x1: 60, y0: 30, y1: 60 } },
        { description: 'Apply a small x/y box in domain units.' },
      )
      .action('Set brush (different box)', {
        name: 'mosaic.set_interval_2d',
        params: { interactorId, x0: 10, x1: 40, y0: 50, y1: 90 },
      })
      .action('Clear brush again', { name: 'mosaic.clear_interval_2d', params: { interactorId } })
      .build(),
  ];
}

const perSpec: Record<string, PlaybookBuilder> = {
  'wnba-shots': (_entry, viewBase) => [
    playbook({
      id: `wnba-shots-menus`,
      title: 'Bidirectional filtering',
      description:
        'Uses the same semantic menu operations an agent can call. Then compare with manual menu interaction and time travel the history.',
    })
      .action('Pick a team (first non-All option)', {
        name: 'mosaic.set_input_option_index',
        params: { ref: `${viewBase}/input/0`, index: 1 },
      })
      .action(
        'Pick an athlete (first non-All option)',
        { name: 'mosaic.set_input_option_index', params: { ref: `${viewBase}/input/1`, index: 1 } },
        { description: 'The Athlete menu is filtered by the selected team.' },
      )
      .action('Clear athlete filter', { name: 'mosaic.clear_input', params: { ref: `${viewBase}/input/1` } })
      .action('Clear team filter', { name: 'mosaic.clear_input', params: { ref: `${viewBase}/input/0` } })
      .build(),
  ],
  weather: (_entry, _viewBase) => [
    playbook({
      id: `weather-linked`,
      title: 'Linked views (brush + toggle)',
      description:
        'Brush the top plot or toggle categories in the bottom plot: both human and agent actions update the same VACP state graph.',
    })
      .action('Set brush range', {
        name: 'mosaic.set_interval_1d',
        params: { plotId: 'plot-0', interactorId: '0', min: 5, max: 20 },
      })
      .action('Toggle “rain” in bars', {
        name: 'mosaic.set_toggle',
        params: { plotId: 'plot-1', interactorId: '0', value: 'rain' },
      })
      .action('Clear toggle', { name: 'mosaic.clear_toggle', params: { plotId: 'plot-1', interactorId: '0' } })
      .action('Clear brush', { name: 'mosaic.clear_interval_1d', params: { plotId: 'plot-0', interactorId: '0' } })
      .build(),
  ],
};

export function buildPlaybooks(entry: GalleryEntry): VacpPlaybook[] {
  const viewBase = `vacp://vacp-examples/mosaic/${entry.id}`;
  const specific = perSpec[entry.id];
  if (specific) return specific(entry, viewBase);

  if (specHasInput(entry)) return menuPlaybook(entry, viewBase);
  if (specHasInterval2D(entry)) return intervalPlaybook(entry, '2d');
  if (specHasInterval1D(entry)) return intervalPlaybook(entry, '1d');

  return [
    playbook({
      id: `${entry.id}-empty`,
      title: 'No scripted playbook',
      description:
        'This spec does not expose a stable, semantic control for a generic playbook. Use the Actions module to dispatch provider actions directly.',
    }).build(),
  ];
}
