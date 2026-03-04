# Website-fc-serve Plugin

![image](https://img.alicdn.com/imgextra/i1/O1CN01X9ucax1hNPxyaFLkb_!!6000000004265-2-tps-1810-686.png)

<p align="center" class="flex justify-center">
  <a href="https://nodejs.org/en/" class="ml-1">
    <img src="https://img.shields.io/badge/node-%3E%3D%2016-brightgreen" alt="node.js version">
  </a>
  <a href="https://github.com/devsapp/website-fc/blob/master/LICENSE" class="ml-1">
    <img src="https://img.shields.io/badge/License-MIT-green" alt="license">
  </a>
</p>

本插件帮助您通过[Serverless-Devs](https://github.com/Serverless-Devs/Serverless-Devs)工具和[FC组件](https://github.com/devsapp/fc)，快速部署静态网站到阿里云函数计算平台。

- [快速开始](#快速开始)
  - [插件作用](#插件作用)
  - [使用教程](#使用教程)
    - [快速上手](#快速上手)
    - [参数说明](#参数说明)
    - [作用域](#作用域)
  - [操作案例](#操作案例)
  - [最佳实践](#最佳实践)
  - [工作原理](#工作原理)
- [关于我们](#关于我们)

## 快速开始

- [源码](https://github.com/devsapp/start-website/tree/master/vuepress/src)
- 快速体验: `s init website-vuepress` or `s init website-vuepress-v3`

### 插件作用

#### 通过CDN+OSS部署

通过[OSS组件](https://github.com/devsapp/oss)可以将静态资源快速部署到阿里云对象存储上，同时分发到CDN节点。不同地域的客户都能快速的访问对应的资源。

![Images](https://img.alicdn.com/imgextra/i4/O1CN01yajAOr1qZd4TVVwCk_!!6000000005510-2-tps-928-468.png)

上面的架构是比较推荐的最佳实践，能够保证高可用，和极致弹性，也是一个标准的Serverless架构。同时用户也能快速的访问它就近的资源，提供了最好的用户体验。

#### 通过函数计算FC部署

通过CDN+OSS的方式虽然在性能和弹性都做到了最优，但是有下面几种场景，用户会选择他的应用部署在函数计算上

- 不希望太复杂的架构，前后端都部署在函数计算上
- FullStack的框架，前后端都是一体化，前端部署在OSS有跨域的问题。如果要解决跨域的问题，又需要引入网关等组件，进一步带来了架构的复杂度
- FaaS厂商一般都有免费额度，我的流量不高，部署在Faas足够用了

![picture](https://img.alicdn.com/imgextra/i2/O1CN01mZSY8t1afYL39b670_!!6000000003357-2-tps-838-492.png)

### 使用教程

#### 快速上手

`website-fc-serve`本质是针对[FC组件](https://serverless-devs.com/fc/readme)进行增强。
还是遵循FC组件的[Yaml规范](https://serverless-devs.com/fc/yaml/readme)，区别在于

1. 在执行部署之前声明对应的插件`website-fc-serve`

```yaml
actions: # 自定义执行逻辑
  pre-deploy: # 在deploy之前运行
    - plugin: website-fc-serve
```

2. 更改函数的 `code` 为静态资源的本地地址

```yaml
resources:
  website:
    component: fc3
    actions: # 自定义执行逻辑
      pre-deploy: # 在deploy之前运行
        - plugin: website-fc-serve
    props: # 组件的属性值
      region: ${vars.region}
      functionName: my-website
      description: "Serverless static website"
      timeout: 30
      memorySize: 512
      code: ./dist # 本地静态资源的地址
```

#### 参数说明

参数详情：

| 参数名称        | 默认值          | 参数含义                                              | 必填  |
| --------------- | --------------- | ----------------------------------------------------- | ----- |
| index           | index.html      | 自定义默认首页                                        | false |
| fallbackToIndex | false           | 是否对未匹配的路由返回首页（SPA 模式，对应 serve -s） | false |
| runtime         | custom.debian11 | 自定义函数运行时                                      | false |
| version         | latest          | serve 依赖版本（npm 版本范围）                        | false |
| headers         | -               | 自定义响应头（用于可观测性、安全策略等）              | false |
| debug           | false           | 调试模式（自动注入版本响应头）                        | false |

我们知道访问静态网站需要一个`html`的页面作为首页，比如您访问`http://www.serverless-devs.com/`首页的时候，其实实际访问的资源是`http://www.serverless-devs.com/index.html`。

`website-fc-serve`插件的默认行为也是会将您的默认首页指向`index.html`。如果您需要自定义您的首页为`demo.html`。只需要做如下声明

```yaml
actions: # 自定义执行逻辑
  pre-deploy: # 在deploy之前运行
    - plugin: website-fc-serve
      args:
        index: demo.html
```

**首页兜底（SPA 模式）**

默认情况下，访问不存在的路径会返回 404。如果您的项目是单页应用（SPA），需要将所有未匹配的路由回退到 `index.html`，可以启用 `fallbackToIndex`：

```yaml
actions: # 自定义执行逻辑
  pre-deploy: # 在deploy之前运行
    - plugin: website-fc-serve
      args:
        fallbackToIndex: true
```

此参数对应 `serve` 的 `-s`（Single Page Application）选项。启用后，任何无法匹配到静态文件的请求都会返回 `index.html`，适用于 Vue Router、React Router 等前端路由方案。

**自定义运行时**

`website-fc-serve`插件默认会将函数的运行时设置为`custom.debian11`。如果您需要使用其他运行时（如 `custom.debian12` 等），可以通过 `runtime` 参数指定：

```yaml
actions: # 自定义执行逻辑
  pre-deploy: # 在deploy之前运行
    - plugin: website-fc-serve
      args:
        runtime: custom.debian12
```

当您指定了 `runtime` 参数后，插件将优先使用您指定的运行时，而不是默认的 `custom.debian11` 运行时。

**serve 版本**

默认使用 npm 上最新稳定版的 `serve`。如需指定版本，可传入 `version` 参数：

```yaml
actions: # 自定义执行逻辑
  pre-deploy: # 在deploy之前运行
    - plugin: website-fc-serve
      args:
        version: 14.2.0
```

可以参考[案例](https://github.com/devsapp/start-realwrold/tree/master/src)

**自定义响应头**

如果您希望在托管 `public` 静态资源时统一追加响应头（例如 `x-trace-id`、`x-observe-app`），可以通过 `headers` 参数配置：

```yaml
actions:
  pre-deploy:
    - plugin: website-fc-serve
      args:
        headers:
          x-observe-app: website
          x-observe-env: prod
```

插件会为 `serve` 生成对应配置，并对 `public` 目录下的所有响应追加这些 header。
当 `debug: true` 时，还会自动注入 `x-website-fc-serve-version: <当前插件版本>`，便于快速定位线上静态服务版本。

```yaml
actions:
  pre-deploy:
    - plugin: website-fc-serve
      args:
        debug: true
```

#### 作用域

`website-fc-serve`只能在`pre-deploy`阶段生效。

```yaml
actions: # 自定义执行逻辑
  pre-deploy: # 在deploy之前运行
    - plugin: website-fc-serve
```

### 操作案例

- 项目目录结构

```
- dist
  - index.html
- s.yaml
```

- yaml配置如下

```yaml
edition: 3.0.0 #  命令行YAML规范版本，遵循语义化版本（Semantic Versioning）规范
name: component-test #  项目名称
access: default # 密钥别名

vars: # 全局变量
  region: cn-hangzhou
  functionName: website-fc-serve

resources:
  website:
    component: fc3
    actions: # 自定义执行逻辑
      pre-deploy: # 在deploy之前运行
        - plugin: website-fc-serve
          args:
            index: demo.html
    props: # 组件的属性值
      region: ${vars.region}
      functionName: ${vars.functionName}
      description: "Serverless Devs Website Function"
      timeout: 30
      memorySize: 512
      code: ./dist
  fc3_domain_0:
    component: fc3-domain
    props:
      region: ${vars.region}
      domainName: auto
      protocol: HTTP
      routeConfig:
        routes:
          - path: /*
            functionName: ${vars.functionName}
```

### 最佳实践

以下是来自社区实践后总结出的最佳实践:

- [如何使用 website-fc 插件部署静态网站到函数计算](https://blog.dengchao.fun/2022/04/02/deploy-static-website-with-website-fc-plugin/) by [DevDengChao](https://github.com/DevDengChao)

欢迎大家通过 PR 投稿更多内容.

### 工作原理

#### 插件运行原理

![image](https://img.alicdn.com/imgextra/i4/O1CN017Zfcf11XmvsJGfMeg_!!6000000002967-2-tps-1462-468.png)
插件本质是上对[组件能力](https://www.serverless-devs.com/fc/readme)的增强，作用在组件的执行前(pre-deploy)以及执行后(post-deploy)。通过修改组件的入参(input)和出参(output)，提供能力。

> 需要注意的是：上一个插件的出参(output)会作为下一个插件或者组件的入参。详情可查看
> [插件模型开发指南](https://www.serverless-devs.com/sdm/serverless_package_model/package_model#%E6%8F%92%E4%BB%B6%E6%A8%A1%E5%9E%8B%E8%A7%84%E8%8C%83)

website-fc-serve 插件在把你的代码部署到云端前将 `runtime` 覆盖为了 `custom.debian11` 运行时, 将 `caPort` 覆盖为了 `9000`,
并在 `code/package.json` 中写入 `serve` 依赖（默认 latest，可通过 `version` 指定）。最终通过 `customRuntimeConfig`
使用 `./node_modules/.bin/serve -s public -l tcp://0.0.0.0:9000` 启动静态文件服务。

#### 零外部依赖

插件本身不依赖任何第三方 npm 包，仅使用 Node.js 内置模块（`fs`、`path`、`child_process`），确保打包体积最小化。

#### Layer 自动配置

插件会自动管理 Node.js 运行时 Layer：

- **未配置 Layer**：自动添加默认的 `Nodejs22` 官方 Layer（`acs:fc:{region}:official:layers/Nodejs22/versions/1`）
- **已配置 Layer 但不包含 Nodejs Layer**：仍然自动补充默认的 `Nodejs22` Layer
- **已配置包含 Nodejs Layer**：从 Layer ARN 中提取 Node.js 版本号，自动调整 `PATH` 中的 `nodejsBin` 路径

例如，如果您配置了 `Nodejs20` 的 Layer：

```yaml
props:
  layers:
    - acs:fc:cn-hangzhou:official:layers/Nodejs20/versions/2
```

插件会自动将 `PATH` 设置为 `/opt/nodejs20/bin`，而非默认的 `/opt/nodejs22/bin`。

> 插件仅识别官方 Nodejs Layer（ARN 格式为 `acs:fc:{region}:official:layers/Nodejs{version}/versions/{n}`）。

#### 环境变量自动配置

插件会自动检查并补充以下环境变量，确保 Node.js 运行时在函数计算环境中正常工作：

| 环境变量          | 默认值                                             | 说明                                                                                                            |
| ----------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `PATH`            | `/opt/nodejs{version}/bin`                         | 根据检测到的 Nodejs Layer 版本自动设置（默认 `nodejs22`），如果 `PATH` 中不包含对应路径，则添加到 `PATH` 最前面 |
| `NODE_PATH`       | `/opt/nodejs/node_modules`                         | 如果未设置 `NODE_PATH`，则自动设置                                                                              |
| `LD_LIBRARY_PATH` | `/code:/code/lib:/usr/lib:/opt/lib:/usr/local/lib` | 如果未设置 `LD_LIBRARY_PATH`，则自动设置                                                                        |

如果您已在 `props.environmentVariables` 中自定义了这些环境变量，插件会保留您的配置不做修改。

# 关于我们

- Serverless Devs 工具：
  - 仓库：[https://www.github.com/serverless-devs/serverless-devs](https://www.github.com/serverless-devs/serverless-devs)
    > 欢迎帮我们增加一个 :star2:
  - 官网：[https://www.serverless-devs.com/](https://www.serverless-devs.com/)
- 阿里云函数计算组件：
  - 仓库：[https://github.com/devsapp/fc](https://github.com/devsapp/fc)
  - 帮助文档：[https://www.serverless-devs.com/fc/readme](https://www.serverless-devs.com/fc/readme)
- 钉钉交流群：33947367
