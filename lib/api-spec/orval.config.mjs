import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "orval";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");
/** Relative paths: Scalar isFilePath treats `C:\...` drive-letter strings unreliably on Windows. */
const contactCrmYaml = "./openapi-contact-crm.yaml";
const venueYaml = "./openapi.yaml";
const mutatorPath = path.resolve(apiClientReactSrc, "custom-fetch.ts");

const titleTransformer = (config) => {
  config.info ??= {};
  config.info.title = "Api";
  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: venueYaml,
      override: { transformer: titleTransformer },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: { includeHttpResponseReturnType: false },
        mutator: { path: mutatorPath, name: "customFetch" },
      },
    },
  },
  "contact-crm-client-react": {
    input: {
      target: contactCrmYaml,
      override: { transformer: titleTransformer },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "contact-generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: { includeHttpResponseReturnType: false },
        mutator: { path: mutatorPath, name: "customFetch" },
      },
    },
  },
  zod: {
    input: {
      target: venueYaml,
      override: { transformer: titleTransformer },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      indexFiles: false,
      override: {
        zod: {
          coerce: {
            query: ["boolean", "number", "string"],
            param: ["boolean", "number", "string"],
            body: ["bigint", "date"],
            response: ["bigint", "date"],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
  "contact-crm-zod": {
    input: {
      target: contactCrmYaml,
      override: { transformer: titleTransformer },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "contact-generated",
      schemas: { path: "contact-generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      indexFiles: false,
      override: {
        zod: {
          coerce: {
            query: ["boolean", "number", "string"],
            param: ["boolean", "number", "string"],
            body: ["bigint", "date"],
            response: ["bigint", "date"],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
