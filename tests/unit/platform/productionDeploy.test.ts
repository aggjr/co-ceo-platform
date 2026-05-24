import {
  parseAppVersion,
  versionGte,
} from '../../../src/core/platform/productionDeploy';

describe('productionDeploy', () => {
  it('compara versões semver', () => {
    expect(versionGte('V0.0.94', 'V0.0.93')).toBe(true);
    expect(versionGte('V0.0.93', 'V0.0.94')).toBe(false);
    expect(versionGte('V0.1.0', 'V0.0.99')).toBe(true);
  });

  it('parseAppVersion extrai patch', () => {
    expect(parseAppVersion('V0.0.94')).toEqual({ major: 0, minor: 0, patch: 94 });
  });
});
