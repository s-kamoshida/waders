import javascriptEslint from '@eslint/js';
import typescriptEslint from 'typescript-eslint';

/** ESLint 設定。any の使用をエラーとし、型をガードレールとして機能させる。 */
export default typescriptEslint.config(
  { ignores: ['dist', 'node_modules', 'data', 'docs'] },
  javascriptEslint.configs.recommended,
  ...typescriptEslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-wrapper-object-types': 'error',
      'max-depth': ['error', 2],
      // Express のエラーハンドラは4引数が必須のため、先頭が _ の未使用引数は許可する
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
