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

  // Anfitrión de la tabla
  'grid.label': 'Tabla de datos',

  // Controles de cabecera
  'header.sortedAscending': 'Orden ascendente. Activar para orden descendente.',
  'header.sortedDescending': 'Orden descendente. Activar para quitar el orden.',
  'header.notSorted': 'Sin ordenar. Activar para orden ascendente.',
  'header.filterColumn': 'Filtrar columna',
  'header.columnMenu': 'Menú de columna',
  'header.autosizeColumn': 'Autoajustar columna',

  // Editores
  'editor.rating': 'Calificación',

  // Anuncios de región activa
  'announce.sortedAscending': 'Ordenado por {label} ascendente',
  'announce.sortedDescending': 'Ordenado por {label} descendente',
  'announce.sortCleared': 'Orden quitado en {label}',
  'announce.filtered': 'Filtro aplicado a {label}',
  'announce.filterCleared': 'Filtro quitado en {label}',
  'announce.selectionCleared': 'Selección borrada',
  'announce.rowSelected': '1 fila seleccionada',
  'announce.rowsSelected': '{count} filas seleccionadas',
  'announce.page': 'Página {page} de {total}',
  'announce.undoOne': 'Deshacer 1 cambio de celda',
  'announce.undoMany': 'Deshacer {count} cambios de celda',
  'announce.redoOne': 'Rehacer 1 cambio de celda',
  'announce.redoMany': 'Rehacer {count} cambios de celda',
  'announce.rowExpanded': 'Fila expandida',
  'announce.rowCollapsed': 'Fila contraída',
  'announce.rowsExpanded': '{count} filas expandidas',
  'announce.allRowsCollapsed': 'Todas las filas contraídas',
  'announce.rowPinnedTop': 'Fila fijada arriba',
  'announce.rowPinnedBottom': 'Fila fijada abajo',
  'announce.rowUnpinned': 'Fila liberada',
  'announce.rowGrabbed':
    'Fila agarrada. Use las flechas para mover, Enter para soltar, Escape para cancelar.',
  'announce.rowMovedTo': 'Fila movida a la posición {position}',
  'announce.rowDropped': 'Fila soltada',
  'announce.reorderCancelled': 'Reordenación cancelada',
  'announce.rowMoved': 'Fila movida',
  'announce.manualOrderCleared': 'Orden manual de filas borrado',

  // Enterprise: filtro de conjunto
  'setFilter.searchPlaceholder': 'Buscar valores…',
  'setFilter.noValues': 'Sin valores',
  'setFilter.selectAll': '(Seleccionar todo)',
  'setFilter.clearFilter': 'Borrar filtro',
  'setFilter.blanks': '(Vacíos)',

  // Enterprise: constructor de filtros avanzado
  'filterBuilder.and': 'Y',
  'filterBuilder.or': 'O',
  'filterBuilder.column': 'Columna',
  'filterBuilder.operator': 'Operador',
  'filterBuilder.value': 'Valor',
  'filterBuilder.addCondition': 'Condición',
  'filterBuilder.addGroup': 'Grupo',
  'filterBuilder.remove': 'Eliminar',
  'filterBuilder.removeGroup': 'Eliminar grupo',
  'filterBuilder.apply': 'Aplicar',
  'filterBuilder.clear': 'Borrar',

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
  'chart.placeholder': 'Seleccione celdas, o agrupe/pivote la tabla, para graficarla.',
  'chart.chartRange': 'Graficar rango',
  'chart.chartView': 'Graficar esta vista',
  'chart.selectionHint': 'Graficar la selección (Alt+F1)',
  'chart.export': 'Exportar',
  'chart.exportPng': 'Imagen PNG',
  'chart.exportSvg': 'Vector SVG',
  'chart.copyImage': 'Copiar imagen',
  'chart.imageCopied': 'Imagen del gráfico copiada al portapapeles',
  'chart.suggested': 'Sugerido',
  'chart.suggestedHint': 'Deja que ApexGrid elija el mejor tipo de gráfico para estos datos',
  'chart.by': 'por',
  'chart.renameHint': 'Haz doble clic para renombrar',
  'chart.emptyTitle': 'Aún no hay nada que graficar',
  'chart.emptyRange': 'Selecciona un rango de celdas, o',
  'chart.emptyView': 'agrupa o dinamiza la cuadrícula',
  'chart.swapAxes': 'Intercambiar ejes (horizontal)',
  'chart.swapAxesHint': 'Intercambia los ejes X e Y (barras horizontales)',
  'chart.data': 'Datos',
  'chart.mapCategory': 'Categoría (X)',
  'chart.mapSeries': 'Series (Y)',
  'chart.mapAggregation': 'Agregación',
  'chart.secondaryAxis': 'Dibujar en el eje secundario (derecho)',
  'chart.secondaryAxisShort': '2.º eje',
  'chart.calcFields': 'Campos calculados',
  'chart.calcName': 'Nombre (p. ej. Bono %)',
  'chart.calcFormula': 'Fórmula (p. ej. B1 / A1 * 100)',
  'chart.calcAdd': 'Añadir campo',
  'chart.calcRemove': 'Eliminar campo calculado',
  'chart.agg.sum': 'Suma',
  'chart.agg.avg': 'Promedio',
  'chart.agg.count': 'Recuento',
  'chart.agg.min': 'Mínimo',
  'chart.agg.max': 'Máximo',
  'chart.agg.median': 'Mediana',
  'chart.format': 'Formato',
  'chart.legend': 'Leyenda',
  'chart.dataLabels': 'Etiquetas de datos',
  'chart.gridlines': 'Líneas de cuadrícula',
  'chart.numberFormat': 'Formato numérico',
  'chart.seriesColors': 'Colores',
  'chart.format.none': 'Simple',
  'chart.format.currency': 'Moneda',
  'chart.format.percent': 'Porcentaje',
  'chart.format.thousands': 'Miles',
  'chart.trendline': 'Línea de tendencia',
  'chart.referenceLine': 'Línea de referencia',
  'chart.referenceBand': 'Banda de referencia',
  'chart.bandFrom': 'Desde',
  'chart.bandTo': 'Hasta',
  'chart.forecast': 'Períodos de pronóstico',
  'chart.forecastBand': 'Banda de pronóstico',
  'chart.axisTitleX': 'Título del eje X',
  'chart.axisTitleY': 'Título del eje Y',
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
  'pivot.total': 'Total',
  'pivot.grandTotal': 'Total general',

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
  'ai.close': 'Cerrar',
  'ai.preview': 'Vista previa',
  'ai.previewHeading': 'Se ejecutaría (no aplicado):',
  'ai.previewEmpty': 'Nada que ejecutar.',
  'ai.viaRule': 'Motor de reglas',
  'ai.viaAI': 'IA',
  'ai.history': 'Historial',
  'ai.clearHistory': 'Borrar',
  'ai.abstained': 'No pude convertir eso en una acción de la tabla.',
  'ai.abstainedHint': 'Prueba a ordenar, filtrar o agrupar, o haz una pregunta sobre los datos.',

  // Fórmulas (enterprise)
  'formula.editorLabel': 'Fórmula',
  'formula.invalid': 'Fórmula no válida',
  'formula.error.ref': 'Referencia de celda no válida',
  'formula.error.name': 'Función desconocida',
  'formula.error.div0': 'División por cero',
  'formula.error.value': 'Valor no válido',
  'formula.error.cycle': 'Referencia circular',
};
