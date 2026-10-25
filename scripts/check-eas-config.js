// Fail before starting a cloud build when interactive EAS onboarding is incomplete.
const { expo } = require('../app.json');

const platform = process.env.BUILD_PLATFORM || 'android';
const errors = [];
const projectId = expo.extra?.eas?.projectId;
if (!projectId || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(projectId)) {
  errors.push('Run npx eas-cli@latest init and commit the generated extra.eas.projectId in app.json.');
}
if (!['android', 'ios', 'all'].includes(platform)) {
  errors.push('BUILD_PLATFORM must be android, ios, or all.');
}
if (['android', 'all'].includes(platform) && !expo.android?.package) {
  errors.push('Configure expo.android.package in app.json using your registered Android application ID.');
}
if (['ios', 'all'].includes(platform) && !expo.ios?.bundleIdentifier) {
  errors.push('Configure expo.ios.bundleIdentifier in app.json using your registered iOS bundle ID.');
}
if (errors.length) {
  console.error(errors.join('\n'));
  console.error('Complete the setup in docs/ci-cd.md before enabling delivery.');
  process.exit(1);
}
console.log(`EAS configuration is ready for ${platform}.`);
