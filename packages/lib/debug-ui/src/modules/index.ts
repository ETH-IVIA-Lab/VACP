import type { VacpDebugModule } from '../types';

import { createActionsModule } from './actions';
import { createDataModule } from './data';
import { createGraphModule } from './graph';
import { createHistoryModule } from './history';
import { createJsonModule } from './json';
import { createPlaybookModule } from './playbook';

export function createDefaultModules(options: {
  direction: 'LR' | 'TB';
  includeActions: boolean;
  includeStatePreview: boolean;
}): VacpDebugModule[] {
  return [
    createGraphModule({
      direction: options.direction,
      includeActions: options.includeActions,
      includeStatePreview: options.includeStatePreview,
    }),
    createDataModule(),
    createActionsModule(),
    createHistoryModule(),
    createPlaybookModule(),
    createJsonModule(),
  ];
}
