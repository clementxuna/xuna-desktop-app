'use strict';

// Builds XUNA AI Beta: production's code with a second identity, which opens beta.xuna.ai (see src/config.js)
// and installs beside production with its own sign-in, data and updates. Beta's releases build with
// `--config electron-builder.beta.js`.
//
// Beta's identity lives here, not in package.json, so that merging the beta branch into main can't change
// production. Git would silently take beta's lines from package.json wherever main hadn't changed them, and
// beta's edited tests with them. So package.json keeps production's values on both branches, and this file
// changes only what makes beta a different app. The version comes from the tag (beta-v1.2.3), for the same reason.

const { build } = require('./package.json');

const PRODUCT_NAME = 'XUNA AI Beta';
// The Windows install folder comes from this name, and an installer stops every process whose path starts with
// its install folder, with no separator after it. So it must not start with production's name, or production's
// updates would close a running beta, and must not be the start of production's name, or the reverse.
const NAME = 'xuna-beta';
// One release whose files every beta build replaces (see "XUNA AI Beta" in the README). GitHub's file host
// answers requests for several ranges at once with 501, and the generic provider sends them unless told not to.
const FEED = 'https://github.com/clementxuna/xuna-desktop-app/releases/download/beta-latest';
// The app's entitlements without push, which would need a provisioning profile for this app ID.
const ENTITLEMENTS = 'build/entitlements.mac.inherit.plist';

// A suffix such as -rc.1 would make electron-builder write beta.yml instead of latest.yml, which installed
// copies don't read, so a bad tag stops the build here, before anything is uploaded.
function betaVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`Beta versions are plain x.y.z, from a tag like beta-v1.2.3 (XUNA_BETA_VERSION). Got: ${JSON.stringify(value)}`);
  }
  return value;
}

function betaBuild(version) {
  const { provisioningProfile, ...mac } = build.mac;
  return {
    ...build,
    appId: 'ai.xuna.desktop.beta',
    productName: PRODUCT_NAME,
    extraMetadata: { name: NAME, productName: PRODUCT_NAME, version: betaVersion(version), xunaChannel: 'beta' },
    win: { ...build.win, icon: 'build/icon-beta.png' },
    nsis: { ...build.nsis, artifactName: 'XUNA-AI-Beta-Setup.${ext}' },
    mac: { ...mac, icon: 'build/icon-mac-beta.png', artifactName: 'XUNA-AI-Beta-mac.${ext}', entitlements: ENTITLEMENTS, entitlementsInherit: ENTITLEMENTS },
    dmg: { ...build.dmg, artifactName: 'XUNA-AI-Beta.${ext}' },
    publish: [{ provider: 'generic', url: FEED, useMultipleRangeRequest: false }],
  };
}

// electron-builder calls this to get its settings.
module.exports = () => betaBuild(process.env.XUNA_BETA_VERSION);
Object.assign(module.exports, { betaBuild, betaVersion });
