let subject = require("../src/index");
let fs = require("fs");
const fse = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { spawn } = require("child_process");
const http = require("http");

jest.setTimeout(120000);

let exampleDir = path.join(__dirname, "../example");
let exampleDist = path.join(__dirname, "../example/dist");
let exampleTmpl = path.join(__dirname, "../example/s.yaml");
let outputDir = path.join(__dirname, "../src/code/public");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const expectedServeCommand = ["./node_modules/.bin/serve"];
const expectedServeArgs = ["-s", "public", "-l", "tcp://0.0.0.0:9000"];


test('props.codeUri not present', async function () {
    try {
        await subject({}, {});
        fail();
    } catch (e) {
        expect(e.message).toBe("props.code not found.");
    }

});

test('path.cwd not present', async function () {
    let result = await subject({
        props: {
            code: exampleDist
        }
    }, {});
    expect(result.props.code).toBe(path.join(__dirname, "../src/code"));
});

test('default index.html', async function () {
    let result = await subject({
        cwd: exampleDir,
        props: {
            code: exampleDist
        }
    }, {});

    // content are copied from exampleDist to outputDir
    expect(fs.readdirSync(outputDir)).toStrictEqual(fs.readdirSync(exampleDist));

    expect(result.props.runtime).toBe("custom.debian11");
    expect(result.props.code).toBe(path.join(__dirname, "../src/code"));
    expect(result.props.caPort).toBe(9000);
    expect(result.props.customRuntimeConfig.command).toStrictEqual(expectedServeCommand);
    expect(result.props.customRuntimeConfig.args).toStrictEqual(expectedServeArgs);
});

test('relative codeUri', async function () {
    let originCodeUri = "./dist";
    let inputs = {
        cwd: exampleDir,
        props: {
            code: originCodeUri
        }
    };
    let result = await subject(inputs, {});

    expect(result.props.code).toBe(path.join(__dirname, "../src/code"));
});

test('custom index.htm', async function () {
    await subject({
        cwd: exampleDir,
        props: {
            code: exampleDist
        }
    }, {
        index: "index.htm"
    });
});

test('props.code is a symlink', async function () {
    const symlinkPath = path.join(__dirname, "../example/dist-link");
    // Clean up symlink if it exists from a previous test run
    if (fse.existsSync(symlinkPath)) {
        fse.removeSync(symlinkPath);
    }
    // Create a junction (works without admin privileges on Windows) or symlink
    fse.ensureSymlinkSync(exampleDist, symlinkPath, 'junction');

    const mockLogger = { debug: jest.fn() };

    try {
        let result = await subject({
            cwd: exampleDir,
            props: {
                code: symlinkPath
            }
        }, {}, mockLogger);

        // content are copied from the resolved actual directory to outputDir
        expect(fs.readdirSync(outputDir)).toStrictEqual(fs.readdirSync(exampleDist));

        expect(result.props.code).toBe(path.join(__dirname, "../src/code"));

        // Verify that the symlink was resolved and logger was called
        expect(mockLogger.debug).toHaveBeenCalledWith(
            expect.stringContaining("Resolved symbolic link to actual path:")
        );
    } finally {
        // Clean up symlink after test
        fse.removeSync(symlinkPath);
    }
});

test('should prioritize user-provided runtime over default', async function () {
    let result = await subject({
        cwd: exampleDir,
        props: {
            code: exampleDist
        }
    }, {
        runtime: "custom.debian12"
    });

    expect(result.props.runtime).toBe("custom.debian12");
    expect(result.props.code).toBe(path.join(__dirname, "../src/code"));
    expect(result.props.caPort).toBe(9000);
    expect(result.props.customRuntimeConfig.command).toStrictEqual(expectedServeCommand);
    expect(result.props.customRuntimeConfig.args).toStrictEqual(expectedServeArgs);
});

test("serve should return index.html content", async function () {

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

    const getWithoutKeepAlive = async (url) => {
        const agent = new http.Agent({ keepAlive: false });
        try {
            return await axios.get(url, { httpAgent: agent });
        } finally {
            agent.destroy();
        }
    };

    const waitForServer = async (url, timeoutMs) => {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            try {
                return await getWithoutKeepAlive(url);
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
        child.kill();
        let closed = await Promise.race([
            closePromise.then(() => true),
            new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
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
            new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
        ]);
        if (!closed && child.exitCode === null) {
            throw new Error("Failed to stop serve process.");
        }
    };

    const codeDir = path.join(__dirname, "../src/code");
    const result = await subject({
        cwd: exampleDir,
        props: {
            code: exampleDist
        }
    }, {});

    await runCommand(npmCommand, ["install", "--no-audit", "--no-fund"], {
        cwd: codeDir,
        stdio: "inherit"
    });

    const serveArgs = result.props.customRuntimeConfig.args;
    // Use absolute path to serve binary for cross-platform compatibility
    // (the relative path in customRuntimeConfig is for Linux FC runtime)
    const serveBin = path.join(codeDir, "node_modules", ".bin", "serve");
    const serverProcess = spawn(serveBin, serveArgs, {
        cwd: codeDir,
        stdio: "inherit",
        shell: true,
    });
    serverProcess.unref();

    try {
        const response = await waitForServer("http://localhost:9000", 30000);
        const indexHtml = fs.readFileSync(path.join(codeDir, "public", "index.html"), "utf-8");
        expect(response.data).toContain(indexHtml.trim());
    } finally {
        await stopProcess(serverProcess, 5000);
    }
});


