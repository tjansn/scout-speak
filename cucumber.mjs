export default {
  paths: ['tests/acceptance/features/**/*.feature'],
  import: ['tests/acceptance/step_definitions/**/*.mjs', 'tests/acceptance/support/**/*.mjs'],
  format: ['progress-bar', 'summary']
};
