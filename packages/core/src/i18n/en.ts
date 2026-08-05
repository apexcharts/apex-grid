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

  // Grid host
  'grid.label': 'Data grid',

  // Header controls
  'header.sortedAscending': 'Sorted ascending. Activate to sort descending.',
  'header.sortedDescending': 'Sorted descending. Activate to clear sort.',
  'header.notSorted': 'Not sorted. Activate to sort ascending.',
  'header.filterColumn': 'Filter column',
  'header.columnMenu': 'Column menu',
  'header.autosizeColumn': 'Autosize column',

  // Editors
  'editor.rating': 'Rating',

  // Live-region announcements
  'announce.sortedAscending': 'Sorted by {label} ascending',
  'announce.sortedDescending': 'Sorted by {label} descending',
  'announce.sortCleared': 'Sort cleared on {label}',
  'announce.filtered': 'Filter applied to {label}',
  'announce.filterCleared': 'Filter cleared on {label}',
  'announce.selectionCleared': 'Selection cleared',
  'announce.rowSelected': '1 row selected',
  'announce.rowsSelected': '{count} rows selected',
  'announce.page': 'Page {page} of {total}',
  'announce.undoOne': 'Undo 1 cell change',
  'announce.undoMany': 'Undo {count} cell changes',
  'announce.redoOne': 'Redo 1 cell change',
  'announce.redoMany': 'Redo {count} cell changes',
  'announce.rowExpanded': 'Row expanded',
  'announce.rowCollapsed': 'Row collapsed',
  'announce.rowsExpanded': '{count} rows expanded',
  'announce.allRowsCollapsed': 'All rows collapsed',
  'announce.rowPinnedTop': 'Row pinned to top',
  'announce.rowPinnedBottom': 'Row pinned to bottom',
  'announce.rowUnpinned': 'Row unpinned',
  'announce.rowGrabbed': 'Row grabbed. Use arrow keys to move, Enter to drop, Escape to cancel.',
  'announce.rowMovedTo': 'Row moved to position {position}',
  'announce.rowDropped': 'Row dropped',
  'announce.reorderCancelled': 'Reorder cancelled',
  'announce.rowMoved': 'Row moved',
  'announce.manualOrderCleared': 'Manual row order cleared',

  // Enterprise: set filter
  'setFilter.searchPlaceholder': 'Search values…',
  'setFilter.noValues': 'No values',
  'setFilter.selectAll': '(Select all)',
  'setFilter.clearFilter': 'Clear filter',
  'setFilter.blanks': '(Blanks)',

  // Enterprise: advanced filter builder
  'filterBuilder.and': 'AND',
  'filterBuilder.or': 'OR',
  'filterBuilder.column': 'Column',
  'filterBuilder.operator': 'Operator',
  'filterBuilder.value': 'Value',
  'filterBuilder.addCondition': 'Condition',
  'filterBuilder.addGroup': 'Group',
  'filterBuilder.remove': 'Remove',
  'filterBuilder.removeGroup': 'Remove group',
  'filterBuilder.apply': 'Apply',
  'filterBuilder.clear': 'Clear',

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
  'chart.placeholder': 'Select cells, or group/pivot the grid, to chart it.',
  'chart.chartRange': 'Chart range',
  'chart.chartView': 'Chart this view',
  'chart.selectionHint': 'Chart the selection (Alt+F1)',
  'chart.countSeries': 'Count',
  'chart.export': 'Export',
  'chart.exportPng': 'PNG image',
  'chart.exportSvg': 'SVG vector',
  'chart.copyImage': 'Copy image',
  'chart.imageCopied': 'Chart image copied to clipboard',
  'chart.suggested': 'Suggested',
  'chart.suggestedHint': 'Let ApexGrid pick the best chart type for this data',
  'chart.by': 'by',
  'chart.renameHint': 'Double-click to rename',
  'chart.emptyTitle': 'Nothing to chart yet',
  'chart.emptyRange': 'Select a range of cells, or',
  'chart.emptyView': 'group or pivot the grid',
  'chart.swapAxes': 'Swap axes (horizontal)',
  'chart.swapAxesHint': 'Swap the X and Y axes (horizontal bars)',
  'chart.data': 'Data',
  'chart.mapCategory': 'Category (X)',
  'chart.mapSeries': 'Series (Y)',
  'chart.mapAggregation': 'Aggregation',
  'chart.secondaryAxis': 'Draw on the secondary (right) axis',
  'chart.secondaryAxisShort': '2nd axis',
  'chart.calcFields': 'Calculated fields',
  'chart.calcName': 'Name (e.g. Bonus %)',
  'chart.calcFormula': 'Formula (e.g. B1 / A1 * 100)',
  'chart.calcAdd': 'Add field',
  'chart.calcRemove': 'Remove calculated field',
  'chart.agg.sum': 'Sum',
  'chart.agg.avg': 'Average',
  'chart.agg.count': 'Count',
  'chart.agg.min': 'Minimum',
  'chart.agg.max': 'Maximum',
  'chart.agg.median': 'Median',
  'chart.format': 'Format',
  'chart.legend': 'Legend',
  'chart.dataLabels': 'Data labels',
  'chart.gridlines': 'Gridlines',
  'chart.numberFormat': 'Number format',
  'chart.seriesColors': 'Colors',
  'chart.format.none': 'Plain',
  'chart.format.currency': 'Currency',
  'chart.format.percent': 'Percent',
  'chart.format.thousands': 'Thousands',
  'chart.trendline': 'Trend line',
  'chart.referenceLine': 'Reference line',
  'chart.referenceBand': 'Reference band',
  'chart.bandFrom': 'From',
  'chart.bandTo': 'To',
  'chart.forecast': 'Forecast periods',
  'chart.forecastBand': 'Forecast band',
  'chart.axisTitleX': 'X-axis title',
  'chart.axisTitleY': 'Y-axis title',
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
  'pivot.total': 'Total',
  'pivot.grandTotal': 'Grand Total',

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
  'ai.close': 'Close',
  'ai.preview': 'Preview',
  'ai.previewHeading': 'Would run (not applied):',
  'ai.previewEmpty': 'Nothing to run.',
  'ai.viaRule': 'Rule engine',
  'ai.viaAI': 'AI',
  'ai.history': 'History',
  'ai.clearHistory': 'Clear',
  'ai.abstained': 'I could not turn that into a grid action.',
  'ai.abstainedHint': 'Try sorting, filtering, or grouping, or ask a question about the data.',

  // Formulas (enterprise)
  'formula.editorLabel': 'Formula',
  'formula.invalid': 'Invalid formula',
  'formula.error.ref': 'Invalid cell reference',
  'formula.error.name': 'Unknown function',
  'formula.error.div0': 'Division by zero',
  'formula.error.value': 'Invalid value',
  'formula.error.cycle': 'Circular reference',
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
