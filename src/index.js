const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const pkg = require("../package.json");
const PORT = 9000;
const HOST = "0.0.0.0";
const CODE_DIR = path.join(__dirname, "./code");

const TEMPLATE_ENTRIES = new Set([
  "package.json",
  "package-lock.json",
  "node_modules",
  "patches",
]);

let cleanupPerformed = false;

function cleanupStaleFunctionDirs() {
  if (cleanupPerformed) return;
  cleanupPerformed = true;
  for (const entry of fs.readdirSync(CODE_DIR)) {
    if (TEMPLATE_ENTRIES.has(entry)) continue;
    const fullPath = path.join(CODE_DIR, entry);
    if (fs.statSync(fullPath).isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }
}

function resolveFunctionDir(inputs) {
  const codeUri = inputs?.props?.code;
  const basePath = inputs?.cwd;
  const funcName =
    inputs?.props?.functionName ??
    crypto
      .createHash("md5")
      .update(path.isAbsolute(codeUri) ? codeUri : path.join(basePath, codeUri))
      .digest("hex")
      .slice(0, 8);
  const codeDir = path.join(CODE_DIR, funcName);
  const publicDir = path.join(codeDir, "public");
  const packageJsonPath = path.join(codeDir, "package.json");
  return { funcName, codeDir, publicDir, packageJsonPath };
}

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
    logWithPluginTag(
      logger,
      "debug",
      `Resolved symbolic link to actual path: ${resolvedCodeUri}`,
    );
  }
  return resolvedCodeUri;
}

function preparePublicDir(sourcePath, indexFile, publicDir) {
  fs.rmSync(publicDir, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
  fs.mkdirSync(publicDir, { recursive: true });
  fs.cpSync(sourcePath, publicDir, { recursive: true });

  if (!fs.existsSync(path.join(publicDir, indexFile))) {
    throw new Error(`${indexFile} file not found.`);
  }
  if (indexFile !== "index.html") {
    fs.cpSync(
      path.join(publicDir, indexFile),
      path.join(publicDir, "index.html"),
    );
  }
}

function updateServeVersion(serveVersion, packageJsonPath) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  const dependencies = { ...(packageJson.dependencies || {}) };
  dependencies.serve = serveVersion;
  packageJson.dependencies = dependencies;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
}

function installDependencies(codeDir) {
  try {
    execSync("npm install --no-audit --no-fund", { cwd: codeDir });
  } catch (error) {
    throw new Error(
      `Failed to install npm dependencies in ${codeDir}: ${error.message}`,
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
              .map(([key, value]) => ({
                key: String(key),
                value: String(value ?? ""),
              }))
          : null;

  if (!normalizedCustomHeaders) {
    throw new Error(
      "args.headers must be an object or an array of { key, value }.",
    );
  }

  const debugHeaders = debug
    ? [{ key: "x-website-fc-serve-version", value: String(pkg.version) }]
    : [];
  const headers = [...debugHeaders, ...normalizedCustomHeaders];
  return Array.from(
    new Map(
      headers.map((header) => [header.key.toLowerCase(), header]),
    ).values(),
  );
}

function writeServeConfig(headers, publicDir) {
  if (headers.length === 0) {
    return null;
  }
  fs.writeFileSync(
    path.join(publicDir, "serve.json"),
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
    envVars.LD_LIBRARY_PATH =
      "/code:/code/lib:/usr/lib:/opt/lib:/usr/local/lib";
  }
  return envVars;
}

function logWithPluginTag(logger, level, message) {
  const constructorMethod = logger?.constructor?.[level];
  if (typeof constructorMethod === "function") {
    constructorMethod.call(logger.constructor, pkg.name, message);
    return;
  }
  logger?.[level]?.(message);
}

function logStartupBanner(logger) {
  const message = `Thanks for using ${pkg.name} ${pkg.version} plugin! Made with ❤️ by DevDengChao.`;
  logWithPluginTag(logger, "info", message);
}

/**
 * Plugin 插件入口
 * @param inputs 组件的入口参数
 * @param args 插件的自定义参数
 * @return inputs
 */

module.exports = async function index(inputs, args, logger) {
  logStartupBanner(logger);
  logWithPluginTag(logger, "debug", `inputs params: ${JSON.stringify(inputs)}`);
  logWithPluginTag(logger, "debug", `args params: ${JSON.stringify(args)}`);

  cleanupStaleFunctionDirs();

  const fallbackToIndex = args?.fallbackToIndex ?? false;
  const runtime = args?.runtime ?? "custom.debian11";
  const index = args?.index ?? "index.html";
  const resolvedCodeUri = resolveCodeUri(inputs, logger);

  const { codeDir, publicDir, packageJsonPath } = resolveFunctionDir(inputs);
  fs.mkdirSync(codeDir, { recursive: true });
  if (!fs.existsSync(packageJsonPath)) {
    fs.cpSync(path.join(CODE_DIR, "package.json"), packageJsonPath);
    const templatePatches = path.join(CODE_DIR, "patches");
    if (fs.existsSync(templatePatches)) {
      fs.cpSync(templatePatches, path.join(codeDir, "patches"), {
        recursive: true,
      });
    }
  }

  preparePublicDir(resolvedCodeUri, index, publicDir);

  const serveVersion = args?.version ?? "latest";
  updateServeVersion(serveVersion, packageJsonPath);
  installDependencies(codeDir);
  logWithPluginTag(logger, "debug", "npm install completed successfully");

  const debug = args?.debug === true;
  const headers = buildHeaders(args?.headers, debug);
  const serveConfigFile = writeServeConfig(headers, publicDir);
  const { layers, nodejsVersion } = resolveLayers(inputs?.props);
  const envVars = buildEnvVars(inputs?.props, nodejsVersion);

  return {
    ...inputs,
    props: {
      ...inputs?.props,
      runtime,
      layers,
      code: codeDir,
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

module.exports.resolveFunctionDir = resolveFunctionDir;
module.exports.cleanupStaleFunctionDirs = cleanupStaleFunctionDirs;
