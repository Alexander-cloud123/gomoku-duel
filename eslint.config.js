// eslint.config.js - ESLint 9 flat config（浏览器 + Worker + Node 脚本）
import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: [
            'lib/**',
            'node_modules/**',
            'docs/**',
            '.github/**',
            'tests/fixtures/**'
        ]
    },
    js.configs.recommended,
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.worker,
                // 由 lib/peerjs.min.js 暴露的全局构造器
                Peer: 'readonly'
            }
        }
    },
    {
        files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser
            }
        }
    },
    {
        rules: {
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_'
            }],
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-console': 'off',
            'prefer-const': 'warn',
            eqeqeq: ['warn', 'smart']
        }
    }
];
