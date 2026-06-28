/**
 * Default English locale dictionary: the single source of truth for every
 * built-in, user-facing string the community grid renders.
 *
 * @remarks
 * Each key is a stable, dot-namespaced identifier. Values may contain
 * `{placeholder}` tokens that {@link localize} interpolates at render time
 * (for example `pagination.summary`). To translate or tweak the UI text,
 * pass a (possibly partial) {@link GridLocaleText} map to
 * {@link ApexGrid.localeText}; any key you omit falls back to the value here.
 *
 * A ready-made Spanish translation ships as `esLocale`.
 */
export const EN_LOCALE = {
  // Pagination
  'pagination.label': 'Grid pagination',
  'pagination.controls': 'Pagination controls',
  'pagination.rowsPerPage': 'Rows per page',
  'pagination.firstPage': 'Go to first page',
  'pagination.previousPage': 'Go to previous page',
  'pagination.nextPage': 'Go to next page',
  'pagination.lastPage': 'Go to last page',
  'pagination.summary': '{start}-{end} of {total}',
  'pagination.summaryEmpty': '0 of 0',

  // Filtering: operators
  'filter.operator.contains': 'Contains',
  'filter.operator.doesNotContain': 'Does not contain',
  'filter.operator.startsWith': 'Starts with',
  'filter.operator.endsWith': 'Ends with',
  'filter.operator.equals': 'Equals',
  'filter.operator.doesNotEqual': 'Does not equal',
  'filter.operator.greaterThan': 'Greater than',
  'filter.operator.lessThan': 'Less than',
  'filter.operator.greaterThanOrEqual': 'Greater than or equal',
  'filter.operator.lessThanOrEqual': 'Less than or equal',
  'filter.operator.empty': 'Empty',
  'filter.operator.notEmpty': 'Not empty',
  'filter.operator.all': 'All',
  'filter.operator.true': 'True',
  'filter.operator.false': 'False',

  // Filtering: UI
  'filter.filter': 'Filter',
  'filter.reset': 'Reset',
  'filter.close': 'Close',
  'filter.removeFilter': 'Remove filter',
  'filter.conditionList': 'Filter condition',
  'filter.changeCondition': 'Change filter condition',
  'filter.inputPlaceholder': 'Add filter value',

  // Rows: selection / expansion
  'row.select': 'Select row',
  'row.expand': 'Expand row',
  'row.collapse': 'Collapse row',
  'row.detail': 'Row detail',
  'header.selectAll': 'Select all rows',
  'header.expandAll': 'Expand all rows',
  'header.collapseAll': 'Collapse all rows',

  // Toolbar
  'toolbar.label': 'Grid toolbar',
  'toolbar.searchPlaceholder': 'Search…',
  'toolbar.export': 'Export',
  'toolbar.exportOptions': 'Export options',
  'toolbar.createChart': 'Create chart',
  'toolbar.exportXlsx': 'Export XLSX',
  'toolbar.askAI': 'Ask AI',

  // Enterprise: set filter
  'setFilter.searchPlaceholder': 'Search values…',
  'setFilter.noValues': 'No values',
  'setFilter.selectAll': '(Select all)',
  'setFilter.clearFilter': 'Clear filter',
  'setFilter.blanks': '(Blanks)',

  // Enterprise: status bar
  'statusBar.selectRange': 'Select a range of cells',
  'statusBar.count': 'Count',
  'statusBar.sum': 'Sum',
  'statusBar.average': 'Avg',
  'statusBar.min': 'Min',
  'statusBar.max': 'Max',

  // Enterprise: tool panel
  'toolPanel.noGrid': 'No grid connected',
  'toolPanel.columns': 'Columns',
  'toolPanel.searchPlaceholder': 'Search columns…',
  'toolPanel.pinColumn': 'Pin column',
  'toolPanel.moveUp': 'Move up',
  'toolPanel.moveDown': 'Move down',
  'toolPanel.groupByColumn': 'Group by this column',
  'toolPanel.pivotMode': 'Pivot mode',
  'toolPanel.rowGroups': 'Row Groups',
  'toolPanel.rowGroupsPivot': 'Row Groups (pivot rows)',
  'toolPanel.values': 'Values',
  'toolPanel.columnLabels': 'Column Labels',
  'toolPanel.dragColumns': 'Drag columns here',
  'toolPanel.removeChip': 'Remove',

  // Enterprise: context menu
  'contextMenu.sortAsc': 'Sort ascending',
  'contextMenu.sortDesc': 'Sort descending',
  'contextMenu.clearSort': 'Clear sort',
  'contextMenu.pinStart': 'Pin to start',
  'contextMenu.pinEnd': 'Pin to end',
  'contextMenu.unpin': 'Unpin',
  'contextMenu.hideColumn': 'Hide column',
  'contextMenu.copy': 'Copy',

  // Enterprise: charts
  'chart.close': 'Close',
  'chart.theme': 'Chart theme',
  'chart.themeGrid': 'Grid theme',
  'chart.themeLight': 'Light',
  'chart.themeDark': 'Dark',
  'chart.placeholder': 'Select cells, or group/pivot the grid, to chart it.',
  'chart.chartRange': 'Chart range',
  'chart.countSeries': 'Count',
  'chart.type.column': 'Column',
  'chart.type.bar': 'Bar',
  'chart.type.line': 'Line',
  'chart.type.area': 'Area',
  'chart.type.pie': 'Pie',
  'chart.type.donut': 'Donut',
  'chart.type.scatter': 'Scatter',
  'chart.type.radar': 'Radar',
  'chart.type.combo': 'Combo',
  'chart.type.auto': 'Auto',

  // Enterprise: row grouping
  'grouping.blank': '(blank)',
  'grouping.expandGroup': 'Expand group',
  'grouping.collapseGroup': 'Collapse group',
  'grouping.announceExpanded': 'Expanded group {label}',
  'grouping.announceCollapsed': 'Collapsed group {label}',

  // Enterprise: pivot
  'pivot.blank': '(blank)',

  // Enterprise: range selection
  'rangeSelection.copied': 'Copied selection to the clipboard',
  'rangeSelection.pasted': 'Pasted {rows} × {cols} cells',

  // Enterprise: AI Toolkit
  'ai.title': 'Ask AI',
  'ai.placeholder': 'Ask the grid to sort, filter, group, or answer a question…',
  'ai.modeControl': 'Change the grid',
  'ai.modeAsk': 'Ask a question',
  'ai.send': 'Send',
  'ai.cancel': 'Cancel',
  'ai.thinking': 'Thinking…',
  'ai.undo': 'Undo',
  'ai.applied': 'Applied',
  'ai.noChanges': 'No changes were applied.',
  'ai.warnings': 'Notes',
  'ai.answer': 'Answer',
  'ai.error': 'Something went wrong.',
  'ai.noAdapter': 'No AI adapter configured. Set grid.aiAdapter to enable.',
  'ai.close': 'Close',
} as const;

/**
 * Union of every built-in locale key. Derived from {@link EN_LOCALE} so the key
 * list and the default strings can never drift apart.
 */
export type GridLocaleKey = keyof typeof EN_LOCALE;

/**
 * A (possibly partial) map of locale keys to translated strings.
 *
 * @remarks
 * Assign to {@link ApexGrid.localeText} to override the built-in English text.
 * Any key you leave out falls back to {@link EN_LOCALE}, so partial maps and
 * incomplete community translations are both valid.
 */
export type GridLocaleText = Partial<Record<GridLocaleKey, string>>;
