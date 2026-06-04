import { elementUpdated, expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import { ApexGridEnterprise, LicenseManager } from '../src/index.js';

type Row = { id: number; name: string };
const data: Row[] = [
  { id: 0, name: 'a' },
  { id: 1, name: 'b' },
];

const WATERMARK = '[part~="license-watermark"]';

/** A valid, far-future, domain-unrestricted key in the canonical APEX- format. */
function validKey() {
  return LicenseManager.generateLicenseKey('2020-01-01', '2999-01-01', 'enterprise');
}

async function mountGrid() {
  const parent = document.createElement('div');
  parent.style.height = '400px';
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data}></apex-grid-enterprise>`,
    { parentNode: parent }
  );
  await elementUpdated(grid);
  return grid;
}

describe('ApexGridEnterprise licensing', () => {
  before(() => ApexGridEnterprise.register());
  afterEach(() => fixtureCleanup());

  it('renders a watermark without a valid license', async () => {
    ApexGridEnterprise.setLicense('not-a-valid-key');
    const grid = await mountGrid();
    expect(LicenseManager.isLicenseValid()).to.be.false;
    expect(grid.renderRoot.querySelector(WATERMARK)).to.exist;
  });

  it('removes the watermark once a valid license is set', async () => {
    const grid = await mountGrid();
    // valid license can be applied after the grid is live; instances re-render
    ApexGridEnterprise.setLicense(validKey());
    await elementUpdated(grid);
    expect(LicenseManager.isLicenseValid()).to.be.true;
    expect(grid.renderRoot.querySelector(WATERMARK)).to.not.exist;
  });

  it('treats an expired key as invalid (still renders)', async () => {
    ApexGridEnterprise.setLicense(
      LicenseManager.generateLicenseKey('2020-01-01', '2020-02-01', 'enterprise')
    );
    const grid = await mountGrid();
    const status = LicenseManager.getLicenseStatus();
    expect(status.valid).to.be.false;
    expect(status.expired).to.be.true;
    expect(grid.renderRoot.querySelector(WATERMARK)).to.exist;
  });

  it('accepts a key generated in the canonical APEX- format', () => {
    expect(validKey().startsWith('APEX-')).to.be.true;
    ApexGridEnterprise.setLicense(validKey());
    expect(LicenseManager.isLicenseValid()).to.be.true;
  });
});
