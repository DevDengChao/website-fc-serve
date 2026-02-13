const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Plugin 插件入口
 * @param inputs 组件的入口参数
 * @param args 插件的自定义参数
 * @return inputs
 */

module.exports = async function index(inputs, args, logger) {
  logger?.debug(`inputs params: ${JSON.stringify(inputs)}`);
  logger?.debug(`args params: ${JSON.stringify(args)}`);
  const codeUri = inputs?.props?.code;
  if (!codeUri) throw new Error("props.code not found.");
  const bashPath = inputs?.cwd;
  let newCodeUri = path.isAbsolute(codeUri)
    ? codeUri
    : path.join(bashPath, codeUri);

  // Resolve symbolic link to actual directory
  const stats = fs.lstatSync(newCodeUri);
  if (stats.isSymbolicLink()) {
    newCodeUri = fs.realpathSync(newCodeUri);
    logger?.debug(`Resolved symbolic link to actual path: ${newCodeUri}`);
  }
  const publicPath = path.join(__dirname, "./code/public");
  const PORT = 9000;
  const HOST = "0.0.0.0";

  fs.rmSync(publicPath, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
  fs.mkdirSync(publicPath, { recursive: true });
  fs.cpSync(newCodeUri, publicPath, { recursive: true });
  const index = args?.index ?? "index.html";
  if (!fs.existsSync(path.join(publicPath, index))) {
    throw new Error(`${index} file not found.`);
  }
  if (index !== "index.html") {
    fs.cpSync(
      path.join(publicPath, index),
      path.join(publicPath, "index.html"),
    );
  }
  const serveVersion = args?.version ?? "latest";
  const packageJsonPath = path.join(__dirname, "./code/package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  const dependencies = { ...(packageJson.dependencies || {}) };

  dependencies.serve = serveVersion;
  packageJson.dependencies = dependencies;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  // Install dependencies via npm
  const codeDir = path.join(__dirname, "./code");
  try {
    execSync("npm install --no-audit --no-fund", { cwd: codeDir });
  } catch (error) {
    throw new Error(
      `Failed to install npm dependencies in ${codeDir}: ${error.message}`,
    );
  }
  logger?.debug("npm install completed successfully");

  const fallbackToIndex = args?.fallbackToIndex ?? false;
  const runtime = args?.runtime ?? "custom.debian11";

  let layers = [...(inputs?.props?.layers ?? [])];
  // Try to detect Node.js version from existing official layers

  // Pattern: acs:fc:{region}:official:layers/Nodejs{version}/versions/{n}
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
  // If no Node.js layer found, add default Nodejs22 layer

  if (!nodejsVersion) {
    let region = inputs?.props?.region;
    if (!region) {
      throw new Error(
        "props.region is required when no Nodejs layer is provided.",
      );
    }
    nodejsVersion = "22";
    const defaultLayer = `acs:fc:${region}:official:layers/Nodejs${nodejsVersion}/versions/1`;
    layers.unshift(defaultLayer);
  }

  // Ensure environment variables for Node.js runtime
  const envVars = { ...(inputs?.props?.environmentVariables ?? {}) };
  const currentPath =
    envVars.PATH ||
    `/var/fc/lang/nodejs${nodejsVersion}/bin:/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/bin:/code:/code/bin`;
  let nodejsBin = `/opt/nodejs${nodejsVersion}/bin`;
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

  return {
    ...inputs,
    props: {
      ...inputs?.props,
      runtime,
      layers,
      code: path.join(__dirname, "./code"),
      customRuntimeConfig: {
        command: ["./node_modules/.bin/serve"],
        args: [
          ...(fallbackToIndex ? ["-s"] : []),
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
