// Supply-only font extension: no runtime behavior.
// This no-op main exists only to satisfy vsce: with `activationEvents` present
// in package.json (even the empty `[]` this package declares), packaging fails
// without a `main` entry point — measured, not assumed.
function activate() {}
function deactivate() {}
module.exports = { activate, deactivate };
