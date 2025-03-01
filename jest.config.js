module.exports = {
  testEnvironment: 'node',
  testEnvironmentOptions: {
    NODE_ENV: 'test',
  },
  restoreMocks: true,
  coveragePathIgnorePatterns: ['node_modules', 'src/config', 'src/app.js', 'tests'],
  coverageReporters: ['text', 'lcov', 'clover', 'html'],

  // 模块映射设置
  moduleNameMapper: {
    '^../../middlewares/auth$': '<rootDir>/tests/mocks/auth.js'
  }
};
