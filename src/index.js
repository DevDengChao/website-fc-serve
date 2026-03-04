const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const pkg = require("../package.json");
const PORT = 9000;
const HOST = "0.0.0.0";
const CODE_DIR = path.join(__dirname, "./code");
const PUBLIC_DIR = path.join(CODE_DIR, "public");
const PACKAGE_JSON_PATH = path.join(CODE_DIR, "package.json");

function resolveCodeUri(inputs, logger) {
  const codeUri = inputs?.props?.code;
  if (!codeUri) throw new Error("props.code not found.");
  const basePath = inputs?.cwd;
  let resolvedCodeUri = path.isAbsolute(codeUri)
    ? codeUri
    : path.join(basePath, codeUri);

  const stats = fs.lstatSync(resolvedCodeUri);
  if (stats.isSymbolicLink()) {
    resolvedCodeUri = fs.realpathSync(resolvedCodeUri);
    logger?.debug(`Resolved symbolic link to actual path: ${resolvedCodeUri}`);
  }
  return resolvedCodeUri;
}

function preparePublicDir(sourcePath, indexFile) {
  fs.rmSync(PUBLIC_DIR, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.cpSync(sourcePath, PUBLIC_DIR, { recursive: true });

  if (!fs.existsSync(path.join(PUBLIC_DIR, indexFile))) {
    throw new Error(`${indexFile} file not found.`);
  }
  if (indexFile !== "index.html") {
    fs.cpSync(
      path.join(PUBLIC_DIR, indexFile),
      path.join(PUBLIC_DIR, "index.html"),
    );
  }
}

function updateServeVersion(serveVersion) {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf-8"));
  const dependencies = { ...(packageJson.dependencies || {}) };
  dependencies.serve = serveVersion;
  packageJson.dependencies = dependencies;
  fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(packageJson, null, 2));
}

function installDependencies() {
  try {
    execSync("npm install --no-audit --no-fund", { cwd: CODE_DIR });
  } catch (error) {
    throw new Error(
      `Failed to install npm dependencies in ${CODE_DIR}: ${error.message}`,
    );
  }
}

function buildHeaders(customHeaders, debug) {
  const normalizedCustomHeaders =
    customHeaders === undefined
      ? []
      : Array.isArray(customHeaders)
      ? customHeaders
          .filter((header) => header?.key)
          .map((header) => ({
            key: String(header.key),
            value: String(header.value ?? ""),
          }))
      : typeof customHeaders === "object" && customHeaders !== null
        ? Object.entries(customHeaders)
            .filter(([key]) => key)
            .map(([key, value]) => ({ key: String(key), value: String(value ?? "") }))
        : null;

  if (!normalizedCustomHeaders) {
    throw new Error("args.headers must be an object or an array of { key, value }.");
  }

  const debugHeaders = debug
    ? [{ key: "x-website-fc-serve-version", value: String(pkg.version) }]
    : [];
  const headers = [...debugHeaders, ...normalizedCustomHeaders];
  return Array.from(
    new Map(headers.map((header) => [header.key.toLowerCase(), header])).values(),
  );
}

function writeServeConfig(headers) {
  if (headers.length === 0) {
    return null;
  }
  fs.writeFileSync(
    path.join(PUBLIC_DIR, "serve.json"),
    JSON.stringify(
      {
        headers: [{ source: "**/*", headers }],
      },
      null,
      2,
    ),
  );
  return "serve.json";
}

function resolveLayers(props) {
  const layers = [...(props?.layers ?? [])];
  const nodejsLayerRegex =
    /^acs:fc:[^:]+:official:layers\/Nodejs(\d+)\/versions\/\d+$/;
  let nodejsVersion = null;
  for (const layer of layers) {
    const match = layer.match(nodejsLayerRegex);
    if (match) {
      nodejsVersion = match[1];
      break;
    }
  }

  if (!nodejsVersion) {
    const region = props?.region;
    if (!region) {
      throw new Error(
        "props.region is required when no Nodejs layer is provided.",
      );
    }
    nodejsVersion = "22";
    const defaultLayer = `acs:fc:${region}:official:layers/Nodejs${nodejsVersion}/versions/1`;
    layers.unshift(defaultLayer);
  }
  return { layers, nodejsVersion };
}

function buildEnvVars(props, nodejsVersion) {
  const envVars = { ...(props?.environmentVariables ?? {}) };
  const currentPath =
    envVars.PATH ||
    `/var/fc/lang/nodejs${nodejsVersion}/bin:/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/bin:/code:/code/bin`;
  const nodejsBin = `/opt/nodejs${nodejsVersion}/bin`;
  const pathEntries = currentPath.split(":");
  if (!pathEntries.includes(nodejsBin)) {
    envVars.PATH = `${nodejsBin}:${currentPath}`;
  }
  if (!envVars.NODE_PATH) {
    envVars.NODE_PATH = "/opt/nodejs/node_modules";
  }
  if (!envVars.LD_LIBRARY_PATH) {
    envVars.LD_LIBRARY_PATH = "/code:/code/lib:/usr/lib:/opt/lib:/usr/local/lib";
  }
  return envVars;
}

/**
 * Plugin 插件入口
 * @param inputs 组件的入口参数
 * @param args 插件的自定义参数
 * @return inputs
 */

module.exports = async function index(inputs, args, logger) {
  logger?.info(`Thanks for using website-fc-serve ${pkg.version} plugin! Made with ❤️ by DevDengChao.`);
  logger?.debug(`inputs params: ${JSON.stringify(inputs)}`);
  logger?.debug(`args params: ${JSON.stringify(args)}`);
  const index = args?.index ?? "index.html";
  const resolvedCodeUri = resolveCodeUri(inputs, logger);
  preparePublicDir(resolvedCodeUri, index);

  const serveVersion = args?.version ?? "latest";
  updateServeVersion(serveVersion);
  installDependencies();
  logger?.debug("npm install completed successfully");

  const fallbackToIndex = args?.fallbackToIndex ?? false;
  const runtime = args?.runtime ?? "custom.debian11";
  const debug = args?.debug === true;
  const headers = buildHeaders(args?.headers, debug);
  const serveConfigFile = writeServeConfig(headers);
  const { layers, nodejsVersion } = resolveLayers(inputs?.props);
  const envVars = buildEnvVars(inputs?.props, nodejsVersion);

  return {
    ...inputs,
    props: {
      ...inputs?.props,
      runtime,
      layers,
      code: CODE_DIR,
      customRuntimeConfig: {
        command: ["./node_modules/.bin/serve"],
        args: [
          ...(fallbackToIndex ? ["-s"] : []),
          ...(serveConfigFile ? ["-c", serveConfigFile] : []),
          "public",
          "-l",
          `tcp://${HOST}:${PORT}`,
        ],
      },
      caPort: PORT,
      environmentVariables: envVars,
    },
  };
};
