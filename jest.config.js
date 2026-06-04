/**
 * jest.config.js
 */

module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        types: ['node', 'jest'],
      },
    }],
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/tests/eucode-generated/',
  ],
  modulePaths: ['node_modules'],
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
  ],
};
