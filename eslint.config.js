import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist-cli', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
)
