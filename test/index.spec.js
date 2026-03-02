let subject = require("../src/index");
let fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const http = require("http");

jest.setTimeout(120000);

let exampleDir = path.join(__dirname, "../example");
let exampleDist = path.join(__dirname, "../example/dist");
let outputDir = path.join(__dirname, "../src/code/public");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const expectedServeCommand = ["./node_modules/.bin/serve"];
const expectedServeArgs = ["public", "-l", "tcp://0.0.0.0:9000"];
const expectedServeArgsWithFallback = [
  "-s",
  "public",
  "-l",
  "tcp://0.0.0.0:9000",
];

test("props.codeUri not present", async function () {
  try {
    await subject({}, {});
    fail();
  } catch (e) {
    expect(e.message).toBe("props.code not found.");
  }
});

test("path.cwd not present", async function () {
  let result = await subject(
    {
      props: {
        code: exampleDist,
        region: "cn-hangzhou",
      },
    },
    {},
  );
  expect(result.props.code).toBe(path.join(__dirname, "../src/code"));
});

test("default index.html", async function () {
  let result = await subject(
    {
      cwd: exampleDir,
      props: {
        code: exampleDist,
        region: "cn-hangzhou",
      },
    },
    {},
  );

  // content are copied from exampleDist to outputDir
  expect(fs.readdirSync(outputDir)).toStrictEqual(fs.readdirSync(exampleDist));

  expect(result.props.runtime).toBe("custom.debian11");
  expect(result.props.code).toBe(path.join(__dirname, "../src/code"));
  expect(result.props.caPort).toBe(9000);
  expect(result.props.customRuntimeConfig.command).toStrictEqual(
    expectedServeCommand,
  );
  expect(result.props.customRuntimeConfig.args).toStrictEqual(
    expectedServeArgs,
  );
});

test("relative codeUri", async function () {
  let originCodeUri = "./dist";
  let inputs = {
    cwd: exampleDir,
    props: {
      code: originCodeUri,
      region: "cn-hangzhou",
    },
  };
  let result = await subject(inputs, {});

  expect(result.props.code).toBe(path.join(__dirname, "../src/code"));
});

test("custom index.htm", async function () {
  await subject(
    {
      cwd: exampleDir,
      props: {
        code: exampleDist,
        region: "cn-hangzhou",
      },
    },
    {
      index: "index.htm",
    },
  );
});

test("props.code is a symlink", async function () {
  const symlinkPath = path.join(__dirname, "../example/dist-link");
  // Clean up symlink if it exists from a previous test run
  if (fs.existsSync(symlinkPath)) {
    fs.rmSync(symlinkPath, { recursive: true, force: true });
  }
  // Create a junction (works without admin privileges on Windows) or symlink
  fs.symlinkSync(exampleDist, symlinkPath, "junction");

  const mockLogger = { debug: jest.fn() };

  try {
    let result = await subject(
      {
        cwd: exampleDir,
        props: {
          code: symlinkPath,
          region: "cn-hangzhou",
        },
      },
      {},
      mockLogger,
    );

    // content are copied from the resolved actual directory to outputDir
    expect(fs.readdirSync(outputDir)).toStrictEqual(
      fs.readdirSync(exampleDist),
    );

    expect(result.props.code).toBe(path.join(__dirname, "../src/code"));

    // Verify that the symlink was resolved and logger was called
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Resolved symbolic link to actual path:"),
    );
  } finally {
    // Clean up symlink after test
    fs.rmSync(symlinkPath, { recursive: true, force: true });
  }
});

test("should prioritize user-provided runtime over default", async function () {
  let result = await subject(
    {
      cwd: exampleDir,
      props: {
        code: exampleDist,
        region: "cn-hangzhou",
      },
    },
    {
      runtime: "custom.debian12",
    },
  );

  expect(result.props.runtime).toBe("custom.debian12");
  expect(result.props.code).toBe(path.join(__dirname, "../src/code"));
  expect(result.props.caPort).toBe(9000);
  expect(result.props.customRuntimeConfig.command).toStrictEqual(
    expectedServeCommand,
  );
  expect(result.props.customRuntimeConfig.args).toStrictEqual(
    expectedServeArgs,
  );
});

test("should add default Nodejs22 layer when no layers provided", async function () {
  let result = await subject(
    {
      cwd: exampleDir,
      props: {
        code: exampleDist,
        region: "cn-hangzhou",
      },
    },
    {},
  );

  expect(result.props.layers).toStrictEqual([
    "acs:fc:cn-hangzhou:official:layers/Nodejs22/versions/1",
  ]);
  expect(result.props.environmentVariables.PATH).toContain("/opt/nodejs22/bin");
});

test("should add default Nodejs22 layer when layers exist but no Nodejs layer", async function () {
  let result = await subject(
    {
      cwd: exampleDir,
      props: {
        code: exampleDist,
        region: "cn-hangzhou",
        layers: ["acs:fc:cn-hangzhou:official:layers/Python310/versions/1"],
      },
    },
    {},
  );

  expect(result.props.layers).toStrictEqual([
    "acs:fc:cn-hangzhou:official:layers/Nodejs22/versions/1",
    "acs:fc:cn-hangzhou:official:layers/Python310/versions/1",
  ]);
  expect(result.props.environmentVariables.PATH).toContain("/opt/nodejs22/bin");
});

test("should detect Nodejs version from existing layer and set nodejsBin accordingly", async function () {
  let result = await subject(
    {
      cwd: exampleDir,
      props: {
        code: exampleDist,
        region: "cn-hangzhou",
        layers: ["acs:fc:cn-hangzhou:official:layers/Nodejs20/versions/2"],
      },
    },
    {},
  );

  // Should NOT add default Nodejs22 layer
  expect(result.props.layers).toStrictEqual([
    "acs:fc:cn-hangzhou:official:layers/Nodejs20/versions/2",
  ]);
  expect(result.props.environmentVariables.PATH).toContain("/opt/nodejs20/bin");
  expect(result.props.environmentVariables.PATH).not.toContain(
    "/opt/nodejs22/bin",
  );
});

test("should use first matched Nodejs layer when multiple exist", async function () {
  let result = await subject(
    {
      cwd: exampleDir,
      props: {
        code: exampleDist,
        region: "cn-hangzhou",
        layers: [
          "acs:fc:cn-hangzhou:official:layers/Nodejs18/versions/1",
          "acs:fc:cn-hangzhou:official:layers/Nodejs22/versions/1",
        ],
      },
    },
    {},
  );

  expect(result.props.layers).toStrictEqual([
    "acs:fc:cn-hangzhou:official:layers/Nodejs18/versions/1",
    "acs:fc:cn-hangzhou:official:layers/Nodejs22/versions/1",
  ]);
  expect(result.props.environmentVariables.PATH).toContain("/opt/nodejs18/bin");
  // Verify only one nodejs bin path exists
  const pathEntries = result.props.environmentVariables.PATH.split(":");
  const nodejsBinEntries = pathEntries.filter((p) =>
    p.match(/\/opt\/nodejs\d+\/bin/),
  );
  expect(nodejsBinEntries).toHaveLength(1);
});

test("should throw error when no layers and no region provided", async function () {
  try {
    await subject(
      {
        cwd: exampleDir,
        props: {
          code: exampleDist,
        },
      },
      {},
    );
    fail();
  } catch (e) {
    expect(e.message).toBe(
      "props.region is required when no Nodejs layer is provided.",
    );
  }
});

test("should not use -s flag by default (fallbackToIndex defaults to false)", async function () {
  let result = await subject(
    {
      cwd: exampleDir,
      props: {
        code: exampleDist,
        region: "cn-hangzhou",
      },
    },
    {},
  );

  expect(result.props.customRuntimeConfig.args).toStrictEqual(
    expectedServeArgs,
  );
  expect(result.props.customRuntimeConfig.args).not.toContain("-s");
});

test("should use -s flag when fallbackToIndex is true", async function () {
  let result = await subject(
    {
      cwd: exampleDir,
      props: {
        code: exampleDist,
        region: "cn-hangzhou",
      },
    },
    {
      fallbackToIndex: true,
    },
  );

  expect(result.props.customRuntimeConfig.args).toStrictEqual(
    expectedServeArgsWithFallback,
  );
  expect(result.props.customRuntimeConfig.args[0]).toBe("-s");
});

test("should not use -s flag when fallbackToIndex is explicitly false", async function () {
  let result = await subject(
    {
      cwd: exampleDir,
      props: {
        code: exampleDist,
        region: "cn-hangzhou",
      },
    },
    {
      fallbackToIndex: false,
    },
  );

  expect(result.props.customRuntimeConfig.args).toStrictEqual(
    expectedServeArgs,
  );
  expect(result.props.customRuntimeConfig.args).not.toContain("-s");
});

test("should not require region when Nodejs layer is already provided", async function () {
  let result = await subject(
    {
      cwd: exampleDir,
      props: {
        code: exampleDist,
        layers: ["acs:fc:cn-hangzhou:official:layers/Nodejs20/versions/1"],
      },
    },
    {},
  );

  expect(result.props.layers).toStrictEqual([
    "acs:fc:cn-hangzhou:official:layers/Nodejs20/versions/1",
  ]);
  expect(result.props.environmentVariables.PATH).toContain("/opt/nodejs20/bin");
});

const runCommand = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: true });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });

const httpGet = (url) =>
  new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ data, res }));
    });
    req.on("error", reject);
  });

const waitForServer = async (url, timeoutMs) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const { data } = await httpGet(url);
      return data;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Server did not become ready in time.");
};

const stopProcess = async (child, timeoutMs) => {
  if (!child || child.exitCode !== null) {
    return;
  }
  const closePromise = new Promise((resolve) => child.once("close", resolve));
  if (process.platform === "win32") {
    // On Windows with shell: true, child.kill() only kills the shell (cmd.exe),
    // not the spawned serve process. Use taskkill /T to kill the process tree.
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } catch (error) {
      // Process may have already exited
    }
    await Promise.race([
      closePromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    // Release child process references to avoid keeping the event loop alive
    child.removeAllListeners();
    child.unref();
  } else {
    child.kill();
    let closed = await Promise.race([
      closePromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    if (closed || !child.pid) {
      return;
    }
    try {
      process.kill(child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") {
        throw error;
      }
    }
    closed = await Promise.race([
      closePromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    if (!closed && child.exitCode === null) {
      throw new Error("Failed to stop serve process.");
    }
  }
};

const codeDir = path.join(__dirname, "../src/code");

const startServe = async () => {
  const result = await subject(
    {
      cwd: exampleDir,
      props: {
        code: exampleDist,
        region: "cn-hangzhou",
      },
    },
    {},
  );

  await runCommand(npmCommand, ["install", "--no-audit", "--no-fund"], {
    cwd: codeDir,
    stdio: "inherit",
  });

  const serveArgs = result.props.customRuntimeConfig.args;
  const serveBin = path.join(codeDir, "node_modules", ".bin", "serve");
  const serverProcess = spawn(serveBin, serveArgs, {
    cwd: codeDir,
    stdio: "ignore",
    shell: true,
  });

  await waitForServer("http://localhost:9000", 30000);
  return serverProcess;
};

test("serve should return index.html content", async function () {
  const serverProcess = await startServe();

  try {
    const { data } = await httpGet("http://localhost:9000");
    const indexHtml = fs.readFileSync(
      path.join(codeDir, "public", "index.html"),
      "utf-8",
    );
    expect(data).toContain(indexHtml.trim());
  } finally {
    await stopProcess(serverProcess, 5000);
  }
});

test("redirect from .html to clean URL should preserve query parameters", async function () {
  const serverProcess = await startServe();

  // Create the test HTML file after startServe, since subject() overwrites public/
  const testHtmlPath = path.join(codeDir, "public", "customer-service.html");
  fs.writeFileSync(testHtmlPath, "<html><body>customer service</body></html>");

  try {
    // Request the .html URL with query parameters — serve's cleanUrls should
    // redirect to the clean URL while preserving the query string.
    const { res } = await httpGet(
      "http://localhost:9000/customer-service.html?user=1&from=test",
    );
    expect(res.statusCode).toBe(301);
    const location = res.headers.location;
    expect(location).toContain("/customer-service");
    expect(location).toContain("user=1");
    expect(location).toContain("from=test");
  } finally {
    fs.unlinkSync(testHtmlPath);
    await stopProcess(serverProcess, 5000);
  }
});
