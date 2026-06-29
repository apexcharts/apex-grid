import type { GridLocaleText } from './en.js';

/**
 * Spanish (Español) translation of the grid's built-in UI text.
 *
 * @remarks
 * A ready-made {@link GridLocaleText} map covering every key in `EN_LOCALE`.
 * Assign it to {@link ApexGrid.localeText} to render the grid in Spanish, or
 * spread it to override individual strings:
 *
 * ```ts
 * import { esLocale } from '@apexcharts/grid';
 *
 * grid.localeText = esLocale;
 * // or, with a tweak:
 * grid.localeText = { ...esLocale, 'toolbar.export': 'Descargar' };
 * ```
 */
export const esLocale: GridLocaleText = {
  // Paginación
  'pagination.label': 'Paginación de la tabla',
  'pagination.controls': 'Controles de paginación',
  'pagination.rowsPerPage': 'Filas por página',
  'pagination.firstPage': 'Ir a la primera página',
  'pagination.previousPage': 'Ir a la página anterior',
  'pagination.nextPage': 'Ir a la página siguiente',
  'pagination.lastPage': 'Ir a la última página',
  'pagination.summary': '{start}-{end} de {total}',
  'pagination.summaryEmpty': '0 de 0',

  // Filtrado: operadores
  'filter.operator.contains': 'Contiene',
  'filter.operator.doesNotContain': 'No contiene',
  'filter.operator.startsWith': 'Empieza por',
  'filter.operator.endsWith': 'Termina en',
  'filter.operator.equals': 'Igual a',
  'filter.operator.doesNotEqual': 'Distinto de',
  'filter.operator.greaterThan': 'Mayor que',
  'filter.operator.lessThan': 'Menor que',
  'filter.operator.greaterThanOrEqual': 'Mayor o igual que',
  'filter.operator.lessThanOrEqual': 'Menor o igual que',
  'filter.operator.empty': 'Vacío',
  'filter.operator.notEmpty': 'No vacío',
  'filter.operator.all': 'Todos',
  'filter.operator.true': 'Verdadero',
  'filter.operator.false': 'Falso',

  // Filtrado: interfaz
  'filter.filter': 'Filtrar',
  'filter.reset': 'Restablecer',
  'filter.close': 'Cerrar',
  'filter.removeFilter': 'Quitar filtro',
  'filter.conditionList': 'Condición de filtro',
  'filter.changeCondition': 'Cambiar condición de filtro',
  'filter.inputPlaceholder': 'Añadir valor de filtro',

  // Filas: selección / expansión
  'row.select': 'Seleccionar fila',
  'row.expand': 'Expandir fila',
  'row.collapse': 'Contraer fila',
  'row.detail': 'Detalle de la fila',
  'header.selectAll': 'Seleccionar todas las filas',
  'header.expandAll': 'Expandir todas las filas',
  'header.collapseAll': 'Contraer todas las filas',

  // Barra de herramientas
  'toolbar.label': 'Barra de herramientas de la tabla',
  'toolbar.searchPlaceholder': 'Buscar…',
  'toolbar.export': 'Exportar',
  'toolbar.exportOptions': 'Opciones de exportación',
  'toolbar.createChart': 'Crear gráfico',
  'toolbar.exportXlsx': 'Exportar XLSX',
  'toolbar.askAI': 'Preguntar a la IA',

  // Enterprise: filtro de conjunto
  'setFilter.searchPlaceholder': 'Buscar valores…',
  'setFilter.noValues': 'Sin valores',
  'setFilter.selectAll': '(Seleccionar todo)',
  'setFilter.clearFilter': 'Borrar filtro',
  'setFilter.blanks': '(Vacíos)',

  // Enterprise: barra de estado
  'statusBar.selectRange': 'Seleccione un rango de celdas',
  'statusBar.count': 'Recuento',
  'statusBar.sum': 'Suma',
  'statusBar.average': 'Prom.',
  'statusBar.min': 'Mín.',
  'statusBar.max': 'Máx.',

  // Enterprise: panel de herramientas
  'toolPanel.noGrid': 'Ninguna tabla conectada',
  'toolPanel.columns': 'Columnas',
  'toolPanel.searchPlaceholder': 'Buscar columnas…',
  'toolPanel.pinColumn': 'Fijar columna',
  'toolPanel.moveUp': 'Subir',
  'toolPanel.moveDown': 'Bajar',
  'toolPanel.groupByColumn': 'Agrupar por esta columna',
  'toolPanel.pivotMode': 'Modo dinámico',
  'toolPanel.rowGroups': 'Grupos de filas',
  'toolPanel.rowGroupsPivot': 'Grupos de filas (filas dinámicas)',
  'toolPanel.values': 'Valores',
  'toolPanel.columnLabels': 'Etiquetas de columna',
  'toolPanel.dragColumns': 'Arrastre columnas aquí',
  'toolPanel.removeChip': 'Quitar',

  // Enterprise: menú contextual
  'contextMenu.sortAsc': 'Ordenar ascendente',
  'contextMenu.sortDesc': 'Ordenar descendente',
  'contextMenu.clearSort': 'Quitar orden',
  'contextMenu.pinStart': 'Fijar al inicio',
  'contextMenu.pinEnd': 'Fijar al final',
  'contextMenu.unpin': 'Desfijar',
  'contextMenu.hideColumn': 'Ocultar columna',
  'contextMenu.copy': 'Copiar',

  // Enterprise: gráficos
  'chart.close': 'Cerrar',
  'chart.theme': 'Tema del gráfico',
  'chart.themeGrid': 'Tema de la tabla',
  'chart.themeLight': 'Claro',
  'chart.themeDark': 'Oscuro',
  'chart.placeholder': 'Seleccione celdas, o agrupe/pivote la tabla, para graficarla.',
  'chart.chartRange': 'Graficar rango',
  'chart.countSeries': 'Recuento',
  'chart.type.column': 'Columnas',
  'chart.type.bar': 'Barras',
  'chart.type.line': 'Líneas',
  'chart.type.area': 'Área',
  'chart.type.pie': 'Circular',
  'chart.type.donut': 'Anillo',
  'chart.type.scatter': 'Dispersión',
  'chart.type.radar': 'Radar',
  'chart.type.combo': 'Combinado',
  'chart.type.auto': 'Automático',

  // Enterprise: agrupación de filas
  'grouping.blank': '(vacío)',
  'grouping.expandGroup': 'Expandir grupo',
  'grouping.collapseGroup': 'Contraer grupo',
  'grouping.announceExpanded': 'Grupo expandido {label}',
  'grouping.announceCollapsed': 'Grupo contraído {label}',

  // Enterprise: tabla dinámica
  'pivot.blank': '(vacío)',

  // Enterprise: selección de rango
  'rangeSelection.copied': 'Selección copiada al portapapeles',
  'rangeSelection.pasted': 'Pegadas {rows} × {cols} celdas',

  // Enterprise: kit de IA
  'ai.title': 'Preguntar a la IA',
  'ai.placeholder': 'Pide a la tabla ordenar, filtrar, agrupar o responder una pregunta…',
  'ai.modeControl': 'Cambiar la tabla',
  'ai.modeAsk': 'Hacer una pregunta',
  'ai.send': 'Enviar',
  'ai.cancel': 'Cancelar',
  'ai.thinking': 'Pensando…',
  'ai.undo': 'Deshacer',
  'ai.applied': 'Aplicado',
  'ai.noChanges': 'No se aplicaron cambios.',
  'ai.warnings': 'Notas',
  'ai.answer': 'Respuesta',
  'ai.error': 'Algo salió mal.',
  'ai.noAdapter': 'No hay adaptador de IA configurado. Asigne grid.aiAdapter para habilitarlo.',
  'ai.close': 'Cerrar',

  // Fórmulas (enterprise)
  'formula.editorLabel': 'Fórmula',
  'formula.invalid': 'Fórmula no válida',
  'formula.error.ref': 'Referencia de celda no válida',
  'formula.error.name': 'Función desconocida',
  'formula.error.div0': 'División por cero',
  'formula.error.value': 'Valor no válido',
  'formula.error.cycle': 'Referencia circular',
};
