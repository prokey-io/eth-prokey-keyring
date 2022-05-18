const config = require('@metamask/eslint-config');
let prettierConfig = config.rules[`prettier/prettier`][1];
prettierConfig['endOfLine'] = 'auto';

module.exports = prettierConfig;
