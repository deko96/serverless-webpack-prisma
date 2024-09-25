import {
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  cpSync,
  existsSync,
  mkdirSync,
} from 'fs';
import { globSync } from 'fast-glob';
import { join, relative } from 'path';
import { get, set, unset, includes, isUndefined } from 'lodash';
import Serverless, { Options as ServerlessOptions } from 'serverless';
import childProcess, { ExecOptions } from 'child_process';

export = class ServerlessWebpackPrisma {
  serverless: Serverless;
  log: ServerlessWriteText;

  options: ServerlessOptions;
  commands: ServerlessCommands;
  hooks: ServerlessHooks;

  constructor(
    serverless: Serverless,
    options: ServerlessOptions,
    { writeText }: ServerlessContext
  ) {
    this.serverless = serverless;
    this.log = writeText;

    this.options = options;
    this.commands = {};
    this.hooks = {
      'after:webpack:package:packExternalModules':
        this.onBeforeWebpackPackage.bind(this),
    };
  }

  runCommand(command: string, args: string[], options: ExecOptions) {
    const strArgs = args.join(' ');
    const cmd = [command, strArgs].join(' ');
    childProcess.execSync(cmd, options);
  }

  getArchitectures() {
    return { arm64: 'linux-arm64', x86_64: 'rhel' };
  }

  getArchitecture() {
    return get(this.serverless, 'service.provider.architecture', 'x86_64') as
      | 'arm64'
      | 'x86_64';
  }

  getPackageManager() {
    return get(this.serverless, 'service.custom.webpack.packager', 'npm');
  }

  getPrismaVersion() {
    return get(this.serverless, 'service.custom.prisma.version', '');
  }

  getInstallDeps() {
    return get(this.serverless, 'service.custom.prisma.installDeps', true);
  }

  getUseSymlink() {
    return get(
      this.serverless,
      'service.custom.prisma.useSymLinkForPrisma',
      false
    );
  }

  getPrismaEngines() {
    const prefix = this.getArchitectures()[this.getArchitecture()];
    return [
      'node_modules/.prisma/client/libquery_engine*',
      `!node_modules/.prisma/client/libquery_engine-${prefix}*`,
      'node_modules/prisma/libquery_engine*',
      `!node_modules/prisma/libquery_engine-${prefix}*`,
      'node_modules/@prisma/engines/libquery_engine*',
      `!node_modules/@prisma/engines/libquery_engine-${prefix}*`,
      'node_modules/@prisma/engines/migration-engine*',
      `!node_modules/@prisma/engines/migration-engine-${prefix}*`,
      'node_modules/@prisma/engines/prisma-fmt*',
      `!node_modules/@prisma/engines/prisma-fmt-${prefix}*`,
      'node_modules/@prisma/engines/introspection-engine*',
      `!node_modules/@prisma/engines/introspection-engine-${prefix}*`,
      'node_modules/@prisma/engines/schema-engine*',
      `!node_modules/@prisma/engines/schema-engine-${prefix}*`,
    ];
  }

  managePackageScripts(action: 'add' | 'remove', cwd: string) {
    const packageJsonPath = join(cwd, 'package.json');
    const contents = readFileSync(packageJsonPath, 'utf-8');
    const parsed = JSON.parse(contents);

    if (action === 'add') {
      set(parsed, 'scripts.prisma:generate', 'prisma generate');
    } else {
      unset(parsed, 'scripts.prisma:generate');
    }

    writeFileSync(packageJsonPath, JSON.stringify(parsed, null, 2));
  }

  installPrismaPackage(cwd: string) {
    this.log('Installing prisma devDependencies...');
    this.managePackageScripts('add', cwd);
    const packageName = ['prisma'];
    if (this.getPrismaVersion()) packageName.push(this.getPrismaVersion());
    const args = ['install', '-D', packageName.join('@')];
    this.runCommand(this.getPackageManager(), args, { cwd });
  }

  removePrismaPackage(cwd: string) {
    this.log('Removing prisma devDependencies...');
    this.managePackageScripts('remove', cwd);
    const args = ['remove', 'prisma'];
    this.runCommand(this.getPackageManager(), args, { cwd });
    this.deletePrismaDirectories(cwd);
  }

  /**
   * "npm remove prisma" fails to remove the "prisma" folder from node_modules
   * since it's a peer dependency of @prisma/client
   * however, removing it manually it's not causing any problems during any function execution that uses prisma
   * and the bundle size is significantly reduced ~15 MB depending on the generated engines
   * https://github.com/danieluhm2004/serverless-webpack-prisma/issues/21
   */
  deletePrismaDirectories(cwd: string) {
    const modules = ['.bin/prisma', 'prisma'];
    for (const module of modules) {
      const modulePath = join(cwd, 'node_modules', module);
      rmSync(modulePath, {
        recursive: true,
        force: true,
      });
    }
  }

  managePrismaSchema(
    action: 'copy' | 'symlink',
    cwd: string,
    prismaDir: string
  ) {
    const targetDir = join(cwd, 'prisma');
    const relativePath = relative(cwd, prismaDir);

    if (action === 'symlink') {
      this.log('Creating symlink for Prisma schema...');
      symlinkSync(relativePath, targetDir, 'dir');
    } else {
      this.log('Copying Prisma schema...');
      const sourceSchemaPath = join(prismaDir, 'schema.prisma');
      const targetSchemaPath = join(targetDir, 'schema.prisma');
      if (!existsSync(targetDir)) mkdirSync(targetDir);
      cpSync(sourceSchemaPath, targetSchemaPath, {
        force: true,
      });
    }
  }

  getPrismaPath() {
    return get(
      this.serverless,
      'service.custom.prisma.prismaPath',
      this.serverless.config.servicePath
    );
  }

  generatePrismaClient(cwd: string) {
    this.log('Generating Prisma client...');
    this.runCommand(this.getPackageManager(), ['run', 'prisma:generate'], {
      cwd,
    });
  }

  getWebpackOutputPath() {
    return get(
      this.serverless,
      'service.custom.webpack.webpackOutputPath',
      this.serverless.config.servicePath
    );
  }

  deleteUnusedEngines(cwd: string) {
    const engines = globSync(this.getPrismaEngines(), { cwd });
    if (!engines.length) return;
    this.log('Removing unused Prisma engines:');
    for (const engine of engines) {
      const enginePath = join(cwd, engine);
      this.log(`  - ${engine}`);
      rmSync(enginePath, {
        force: true,
      });
    }
  }

  getFunctionNames() {
    const packageIndividually = get(
      this.serverless,
      'service.package.individually',
      false
    );
    return packageIndividually ? this.getNodeFunctions() : ['service'];
  }

  getIgnoredFunctions() {
    return get(this.serverless, 'service.custom.prisma.ignoreFunctions', []);
  }

  getProviderRuntime() {
    return get(this.serverless, 'service.provider.runtime');
  }

  isFunctionImage(
    func:
      | Serverless.FunctionDefinitionHandler
      | Serverless.FunctionDefinitionImage
  ): func is Serverless.FunctionDefinitionImage {
    return !isUndefined((func as Serverless.FunctionDefinitionImage).image);
  }

  isFunctionIgnored(funcName: string) {
    const ignoredFunctions = this.getIgnoredFunctions();
    return includes(ignoredFunctions, funcName);
  }

  isRuntimeNode(func: Serverless.FunctionDefinitionHandler) {
    const funcRuntime = get(func, 'handler.runtime', '');
    const providerRuntime = this.getProviderRuntime() || 'node';
    return !!funcRuntime.match(/node/) || !!providerRuntime.match(/node/);
  }

  getNodeFunctions() {
    const functions = this.serverless.service.getAllFunctions();
    return functions.filter((funcName) => {
      const func = this.serverless.service.getFunction(funcName);

      if (this.isFunctionImage(func)) return false;
      if (!this.isRuntimeNode(func)) return false;
      if (this.isFunctionIgnored(funcName)) return false;

      return true;
    });
  }

  onBeforeWebpackPackage() {
    const prismaRelativePath = this.getPrismaPath();
    const prismaDir = join(prismaRelativePath, 'prisma');
    const webpackDir = join(this.getWebpackOutputPath(), '.webpack');
    const functions = this.getFunctionNames();
    const schemaAction = this.getUseSymlink() ? 'symlink' : 'copy';

    for (const funcName of functions) {
      const cwd = join(webpackDir, funcName);

      if (this.getInstallDeps()) this.installPrismaPackage(cwd);

      this.managePrismaSchema(schemaAction, cwd, prismaDir);
      this.generatePrismaClient(cwd);
      this.deleteUnusedEngines(cwd);

      if (this.getInstallDeps()) this.removePrismaPackage(cwd);
    }
  }
};
