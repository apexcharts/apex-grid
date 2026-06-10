# Changelog — apex-grid-enterprise

All notable changes to the `apex-grid-enterprise` (pro) package are documented
here. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and the format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.1.1] — unreleased

Documentation-only patch (no runtime or API changes).

### Documentation
- README: added a licensing example (`ApexGridEnterprise.setLicense(key)`) and a
  column-aggregations example (`aggregations` property + `getAggregations()`
  result shape); removed the dangling "licensing docs" reference.
- JSDoc: added `@element apex-grid-enterprise`, documented the
  `license-watermark` CSS part, and noted that all `apex-grid` events are
  inherited.

## [0.1.0] — 2026-06-09

Initial release. Pro-licensed grid that extends the community
[`apex-grid`](https://www.npmjs.com/package/apex-grid) and registers as
`<apex-grid-enterprise>` — a drop-in replacement for `<apex-grid>`.

### Added
- **Licensing** (offline, non-hostile): `ApexGridEnterprise.setLicense(key)`.
  Without a valid key the grid keeps working but renders a watermark and logs a
  console notice. Re-exports `LicenseManager` from `apex-commons`.
- **Column aggregations** — sum / avg / min / max / count per column via the
  `aggregations` property and `getAggregations()`.
- **Excel (XLSX) export** — `exportToXLSX({ filename, sheetName, source, columns })`
  plus an "Export XLSX" entry in the toolbar export menu. Numbers, booleans, and
  `Date` values keep their native Excel cell types. (Moved here from the
  community package in apex-grid v3; CSV export stays free in core.)

### Dependencies
- `apex-grid` `^3.0.0`, `apex-commons` `^0.1.0`. Peer deps: `lit`, `@lit/context`,
  `igniteui-webcomponents` (shared single copy with core).

[0.1.1]: https://github.com/apexcharts/apex-grid/releases
[0.1.0]: https://github.com/apexcharts/apex-grid/releases
