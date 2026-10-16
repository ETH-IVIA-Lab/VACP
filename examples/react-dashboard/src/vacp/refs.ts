import { createVacpRefBuilder } from '@vacp/sdk';

const appId = 'vacp-examples';
const viewId = 'react/dashboard';
const vizId = 'recharts';

const viewRefs = createVacpRefBuilder({ appId, viewId });
const vizRefs = createVacpRefBuilder({ appId, viewId, vizId });
const appRef = `vacp://${appId}`;
const viewRef = viewRefs.root;
const vizRef = vizRefs.root;

const scatterVizRef = vizRefs.ref('/viz/scatter');
const distributionVizRef = vizRefs.ref('/viz/distribution');
const distributionXVizRef = vizRefs.ref('/viz/distribution/x');
const distributionYVizRef = vizRefs.ref('/viz/distribution/y');
const tableVizRef = vizRefs.ref('/viz/table');

const scatterRef = vizRefs.ref('/viz/scatter/mark/scatter');
const distributionXRef = vizRefs.ref('/viz/distribution/x/mark/pdf');
const distributionYRef = vizRefs.ref('/viz/distribution/y/mark/pdf');
const tableRef = vizRefs.ref('/viz/table/mark/table');

const selectionRef = vizRefs.ref('/viz/scatter/selection/points');
const brush2dRef = vizRefs.ref('/viz/scatter/selection/brush2d');
const handleRef = vizRefs.ref('/data/rows');

export const dashboardIdentity = { appId, viewId, vizId };
export const dashboardRefs = {
  appRef,
  viewRef,
  vizRef,
  scatterVizRef,
  distributionVizRef,
  distributionXVizRef,
  distributionYVizRef,
  tableVizRef,
  scatterRef,
  distributionXRef,
  distributionYRef,
  tableRef,
  selectionRef,
  brush2dRef,
  handleRef,
} as const;
