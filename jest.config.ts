export default {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  setupFiles: ["dotenv/config"],
  moduleNameMapper: {
    "^jose$": "<rootDir>/src/__mocks__/jose.ts"
  }
};
