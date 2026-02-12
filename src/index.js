const lodash = require("lodash");
const path = require("path");
const fse = require("fs-extra");
const rimraf = require("rimraf");
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
  const codeUri = lodash.get(inputs, "props.code");
  if (lodash.isEmpty(codeUri)) throw new Error("props.code not found.");
  const bashPath = lodash.get(inputs, "cwd");
  let newCodeUri = path.isAbsolute(codeUri)
    ? codeUri
    : path.join(bashPath, codeUri);

  // Resolve symbolic link to actual directory
  const stats = fse.lstatSync(newCodeUri);
  if (stats.isSymbolicLink()) {
    newCodeUri = fse.realpathSync(newCodeUri);
    logger.debug(`Resolved symbolic link to actual path: ${newCodeUri}`);
  }
  const publicPath = path.join(__dirname, "./code/public");
  const PORT = 9000;
  const HOST = "0.0.0.0";

  rimraf.sync(publicPath);
  fse.ensureDirSync(publicPath);
  fse.copySync(newCodeUri, publicPath);
  const index = lodash.get(args, "index", "index.html");
  if (!fse.existsSync(path.join(publicPath, index))) {
    throw new Error(`${index} file not found.`);
  }
  if (index !== "index.html") {
    fse.copySync(
      path.join(publicPath, index),
      path.join(publicPath, "index.html"),
    );
  }
  const serveVersion = lodash.get(args, "version", "latest");
  const packageJsonPath = path.join(__dirname, "./code/package.json");
  const packageJson = fse.readJsonSync(packageJsonPath);
  const dependencies = { ...(packageJson.dependencies || {}) };
  delete dependencies.express;
  dependencies.serve = serveVersion;
  packageJson.dependencies = dependencies;
  fse.writeJsonSync(packageJsonPath, packageJson, { spaces: 2 });

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

  const runtime = lodash.get(args, "runtime", "custom.debian11");

  let layers = lodash.get(inputs, "props.layers", []);
  let region = lodash.get(inputs, "props.region");
  // https://github.com/awesome-fc/awesome-layers/tree/main/docs/Nodejs22
  let nodejsLayer = `acs:fc:${region}:official:layers/Nodejs22/versions/2`;
  if (!layers.includes(nodejsLayer)) layers.unshift(nodejsLayer);

  // Ensure environment variables for Node.js runtime
  const envVars = { ...lodash.get(inputs, "props.environmentVariables", {}) };
  const currentPath = envVars.PATH || "";
  let nodejsBin = `/opt/nodejs22/bin`;
  if (!currentPath.includes(nodejsBin)) {
    envVars.PATH = currentPath ? `${nodejsBin}:${currentPath}` : nodejsBin;
  }
  if (!envVars.NODE_PATH) {
    envVars.NODE_PATH = "/opt/nodejs/node_modules";
  }
  if (!envVars.LD_LIBRARY_PATH) {
    envVars.LD_LIBRARY_PATH =
      "/code:/code/lib:/usr/lib:/opt/lib:/usr/local/lib";
  }

  return lodash.merge(inputs, {
    props: {
      runtime,
      code: path.join(__dirname, "./code"), // 支持ZIP能力
      customRuntimeConfig: {
        command: ["./node_modules/.bin/serve"],
        args: ["-s", "public", "-l", `tcp://${HOST}:${PORT}`],
      },
      caPort: PORT,
      environmentVariables: envVars,
    },
  });
};
