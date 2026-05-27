/**
 * jest.config.js
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Removendo moduleNameMapper para evitar conflitos com módulos internos como source-map, 
  // confiando na configuração padrão do ts-jest e no path resolution do Node/Jest.
  modulePaths: ['node_modules'],
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}', // Coleta de cobertura em src/
  ],
};