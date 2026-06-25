import { ApexGridChart } from './chart-panel.js';
import { ApexGridEnterprise } from './grid-enterprise.js';
import { enterpriseModules } from './modules.js';
import { ApexGridSetFilter } from './set-filter.js';
import { ApexGridStatusBar } from './status-bar.js';
import { ApexGridToolPanel } from './tool-panel.js';

export {
  ApexGridChart,
  ApexGridEnterprise,
  ApexGridSetFilter,
  ApexGridStatusBar,
  ApexGridToolPanel,
};

// Batteries-included entry: opt the grid into every built-in feature module,
// then register the full enterprise element set (the grid plus its companion
// sibling elements: columns tool panel, selection status bar, set filter).
// Import from the package root instead to opt into only the modules you use.
ApexGridEnterprise.use(...enterpriseModules);
ApexGridEnterprise.register();
ApexGridToolPanel.register();
ApexGridStatusBar.register();
ApexGridSetFilter.register();
ApexGridChart.register();
