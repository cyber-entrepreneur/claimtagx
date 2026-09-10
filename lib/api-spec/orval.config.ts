import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const here = path.resolve(__dirname);
const root = path.resolve(here, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");
const venueYaml = path.resolve(here, "openapi.yaml");
const contactCrmYaml = path.resolve(here, "openapi-contact-crm.yaml");
const mutatorPath = path.resolve(apiClientReactSrc, "custom-fetch.ts");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: venueYaml,
      override: {
        transformer: titleTransformer,
      },
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
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: mutatorPath,
          name: "customFetch",
        },
      },
    },
  },
  /** Contact CRM contract — separate target so venue OpenAPI clean does not erase CRM clients. */
  "contact-crm-client-react": {
    input: {
      target: contactCrmYaml,
      override: {
        transformer: titleTransformer,
      },
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
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: mutatorPath,
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: venueYaml,
      override: {
        transformer: titleTransformer,
      },
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
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
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
      override: {
        transformer: titleTransformer,
      },
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
