import { Highlight, Interval1D, Interval2D, Nearest, PanZoom, Region, Toggle } from '@uwdata/mosaic-plot';
import { Menu, Search, Slider, Table } from '@uwdata/mosaic-inputs';

/**
 * VGPlot builds every interactor, legend handler, and input from the classes Mosaic exports.
 * Class identity survives minification; constructor names do not, so production builds
 * classify native objects here and nowhere else.
 */
const interactorClasses = { Interval1D, Interval2D, Toggle, Nearest, PanZoom, Region, Highlight } as const;
const inputClasses = { Menu, Search, Slider, Table } as const;

export type VgplotInteractorType = keyof typeof interactorClasses;
export type VgplotInputType = keyof typeof inputClasses;

function classify<Type extends string>(
  classes: Readonly<Record<Type, abstract new (...args: never[]) => unknown>>,
  owner: string,
  value: unknown,
): Type | undefined {
  if (!value || typeof value !== 'object') return undefined;
  for (const type of Object.keys(classes) as Type[]) if (value instanceof classes[type]) return type;
  // An unminified class with a known name that fails identity comes from a second Mosaic copy.
  const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
  if (typeof name === 'string' && Object.hasOwn(classes, name))
    throw new Error(
      `VGPlot ${name} comes from a different copy of ${owner}. Install one version shared by @uwdata/vgplot and @ethivia/vacp-adapter-vgplot.`,
    );
  return undefined;
}

/** The Mosaic interactor class of a plot interactor or legend handler. */
export function interactorType(value: unknown): VgplotInteractorType | undefined {
  return classify(interactorClasses, '@uwdata/mosaic-plot', value);
}

/** The Mosaic input class of a dashboard widget. */
export function inputType(value: unknown): VgplotInputType | undefined {
  return classify(inputClasses, '@uwdata/mosaic-inputs', value);
}
