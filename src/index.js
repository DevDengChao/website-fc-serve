
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
    fse.copySync(path.join(publicPath, index), path.join(publicPath, "index.html"));
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
    throw new Error(`Failed to install npm dependencies in ${codeDir}: ${error.message}`);
  }
  logger?.debug("npm install completed successfully");

  const runtime = lodash.get(args, "runtime", "custom.debian11");
  return lodash.merge(inputs, {
    props: {
        runtime,
        code: path.join(__dirname, "./code"), // 支持ZIP能力
        customRuntimeConfig: {
          command: ["./node_modules/.bin/serve"],
          args: ["-s", "public", "-l", `tcp://${HOST}:${PORT}`],
        },
        caPort: PORT,
    },
  });
};
