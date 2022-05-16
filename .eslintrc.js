module.exports = {
  root: true,
  ignorePatterns: ['lib/**/*'],
  parserOptions: {
    ecmaVersion: 2018, // to support object rest spread, e.g. {...x, ...y}
  },
  extends: ['@metamask/eslint-config', '@metamask/eslint-config-nodejs'],
  env: {
    commonjs: true,
    browser: true,
  },
  overrides: [
    {
      files: ['test/**/*.js'],
      extends: ['@metamask/eslint-config-jest'],
    },
  ],
  rules: {
    camelcase: [
      'error',
      {
        allow: ['signTypedData_v1', 'signTypedData_v3', 'signTypedData_v4'],
      },
    ],
  },
};
