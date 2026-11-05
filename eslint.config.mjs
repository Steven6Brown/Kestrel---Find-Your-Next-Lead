import coreWebVitals from "eslint-config-next/core-web-vitals";

const config = [...coreWebVitals, { ignores: [".next/**", ".next-*/**", "node_modules/**", "data/**"] }];
export default config;
