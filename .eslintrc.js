module.exports = {
    root: true,
  
    extends: [
      '@metamask/eslint-config',
      '@metamask/eslint-config/config/mocha',
      '@metamask/eslint-config/config/nodejs',
    ],
  
    parser: 'babel-eslint',
  
    parserOptions: {
      ecmaVersion: 2017,
    },
  
    plugins: [
      'json',
      'import',
    ],
  
    overrides: [{
      files: [
        '.eslintrc.js',
      ],
      parserOptions: {
        sourceType: 'script',
      },
    }],
  
    ignorePatterns: ['dist'],
  }