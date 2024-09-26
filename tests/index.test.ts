import path from 'path';
import fs from 'fs';
import childProcess from 'child_process';
import glob from 'fast-glob';
import _ from 'lodash';
import ServerlessWebpackPrisma from '../src/';
import Serverless, { Options as ServerlessOptions } from 'serverless';

jest.mock('fs');
jest.mock('child_process');

describe('ServerlessWebpackPrisma Plugin', () => {
  let plugin: ServerlessWebpackPrisma;
  let mockServerless: Serverless;
  let mockOptions: ServerlessOptions;
  let mockLogger: ServerlessWriteText;
  const mockCwd = '/fake-dir';
  const mockPrismaDir = '/prisma-dir';
  const mockFunctions = {
    fn1: {},
    fn2: {},
  };

  beforeEach(() => {
    mockLogger = jest.fn();
    mockServerless = {
      service: {
        functions: mockFunctions,
        custom: {
          webpack: {},
          prisma: {
            ignoredFunctions: ['fn2'],
          },
        },
        provider: {},
        getAllFunctions: jest.fn().mockReturnValue(Object.keys(mockFunctions)),
        getFunction: jest
          .fn()
          .mockImplementation((name) => _.get(mockFunctions, name)),
      },
      config: { servicePath: '/service/path' },
    } as unknown as Serverless;
    mockOptions = {};
    plugin = new ServerlessWebpackPrisma(mockServerless, mockOptions, {
      writeText: mockLogger,
    });
  });

  test('runCommand should execute a command with childProcess', () => {
    const command = 'npm';
    const args = ['install'];
    const options = { cwd: mockCwd };

    plugin.runCommand(command, args, options);

    expect(childProcess.execSync).toHaveBeenCalledWith('npm install', options);
  });

  test('getArchitectures should return correct architecture mapping', () => {
    const result = plugin.getArchitectures();
    expect(result).toEqual({ arm64: 'linux-arm64', x86_64: 'rhel' });
  });

  test('getArchitecture should return the default architecture', () => {
    const architecture = plugin.getArchitecture();
    expect(architecture).toBe('x86_64');
  });

  test('getArchitecture should return custom architecture', () => {
    _.set(mockServerless, 'service.provider.architecture', 'arm64');
    const architecture = plugin.getArchitecture();
    expect(architecture).toBe('arm64');
  });

  test('getPackageManager should return the default package manager', () => {
    const result = plugin.getPackageManager();
    expect(result).toBe('npm');
  });

  test('getPackageManager should return a custom package manager', () => {
    _.set(mockServerless, 'service.custom.webpack.packager', 'yarn');
    const result = plugin.getPackageManager();
    expect(result).toBe('yarn');
  });

  test('getPrismaVersion should return the prisma version', () => {
    _.set(mockServerless, 'service.custom.prisma.version', '5.0.0');
    const result = plugin.getPrismaVersion();
    expect(result).toBe('5.0.0');
  });

  test('getInstallDeps should return the installDeps value', () => {
    _.set(mockServerless, 'service.custom.prisma.installDeps', false);
    const result = plugin.getInstallDeps();
    expect(result).toBe(false);
  });

  test('getUseSymlink should return the useSymLinkForPrisma value', () => {
    _.set(mockServerless, 'service.custom.prisma.useSymLinkForPrisma', true);
    const result = plugin.getUseSymlink();
    expect(result).toBe(true);
  });

  test('getIsDataProxy should return the dataProxy value', () => {
    _.set(mockServerless, 'service.custom.prisma.dataProxy', true);
    const result = plugin.getIsDataProxy();
    expect(result).toBe(true);
  });

  test('getPrismaPath should return the prismaPath value', () => {
    _.set(mockServerless, 'service.custom.prisma.prismaPath', '../../');
    const result = plugin.getPrismaPath();
    expect(result).toBe('../../');
  });

  test("getWebpackOutputPath should return webpack's webpackOutputPath value", () => {
    _.set(mockServerless, 'service.custom.webpack.webpackOutputPath', '../../');
    const result = plugin.getWebpackOutputPath();
    expect(result).toBe('../../');
  });

  test('managePackageScripts should add prisma generate script', () => {
    const packageJson = { scripts: {} };
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(packageJson));
    plugin.managePackageScripts('add', mockCwd);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(mockCwd, 'package.json'),
      JSON.stringify(
        {
          scripts: {
            'prisma:generate': 'prisma generate',
          },
        },
        null,
        2
      )
    );
  });

  test('managePackageScripts should add prisma generate script with --data-proxy', () => {
    const packageJson = { scripts: {} };
    _.set(mockServerless, 'service.custom.prisma.dataProxy', true);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(packageJson));
    plugin.managePackageScripts('add', mockCwd);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(mockCwd, 'package.json'),
      JSON.stringify(
        {
          scripts: {
            'prisma:generate': 'prisma generate --data-proxy',
          },
        },
        null,
        2
      )
    );
  });

  test('managePackageScripts should remove prisma generate script', () => {
    const packageJson = { scripts: { 'prisma:generate': 'prisma generate' } };
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(packageJson));
    plugin.managePackageScripts('remove', mockCwd);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(mockCwd, 'package.json'),
      JSON.stringify({ scripts: {} }, null, 2)
    );
  });

  test('installPrismaPackage should install the latest prisma release', () => {
    const managePackageScripts = jest.spyOn(plugin, 'managePackageScripts');
    const runCommand = jest.spyOn(plugin, 'runCommand');

    plugin.installPrismaPackage(mockCwd);

    expect(managePackageScripts).toHaveBeenCalledWith('add', mockCwd);
    expect(runCommand).toHaveBeenCalledWith(
      'npm',
      ['install', '-D', 'prisma'],
      {
        cwd: mockCwd,
      }
    );
  });

  test('installPrismaPackage should install specific prisma version', () => {
    _.set(mockServerless, 'service.custom.prisma.version', '5.0.0');
    const managePackageScripts = jest.spyOn(plugin, 'managePackageScripts');
    const runCommand = jest.spyOn(plugin, 'runCommand');

    plugin.installPrismaPackage(mockCwd);

    expect(managePackageScripts).toHaveBeenCalledWith('add', mockCwd);
    expect(runCommand).toHaveBeenCalledWith(
      'npm',
      ['install', '-D', 'prisma@5.0.0'],
      {
        cwd: mockCwd,
      }
    );
  });

  test('removePrismaPackage should remove prisma and delete directories', () => {
    const runCommand = jest.spyOn(plugin, 'runCommand');
    const deletePrismaDirectories = jest.spyOn(
      plugin,
      'deletePrismaDirectories'
    );

    plugin.removePrismaPackage(mockCwd);

    expect(deletePrismaDirectories).toHaveBeenCalledWith(mockCwd);
    expect(runCommand).toHaveBeenCalledWith('npm', ['remove', 'prisma'], {
      cwd: mockCwd,
    });
  });

  test('deletePrismaDirectories should delete prisma-related directories', () => {
    const rmSync = jest.spyOn(fs, 'rmSync');
    plugin.deletePrismaDirectories(mockCwd);

    expect(rmSync).toHaveBeenCalledTimes(2);
    ['.bin/prisma', 'prisma'].forEach((relativePath) => {
      expect(rmSync).toHaveBeenCalledWith(
        path.join(mockCwd, 'node_modules', relativePath),
        { recursive: true, force: true }
      );
    });
  });

  test('managePrismaSchema should copy prisma schema', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    plugin.managePrismaSchema('copy', mockCwd, mockPrismaDir);

    expect(fs.cpSync).toHaveBeenCalledWith(
      path.join(mockPrismaDir, 'schema.prisma'),
      path.join(mockCwd, 'prisma', 'schema.prisma'),
      { force: true }
    );
  });

  test('managePrismaSchema should symlink prisma schema', () => {
    plugin.managePrismaSchema('symlink', mockCwd, mockPrismaDir);

    expect(fs.symlinkSync).toHaveBeenCalledWith(
      path.relative(mockCwd, mockPrismaDir),
      path.join(mockCwd, 'prisma'),
      'dir'
    );
  });

  test('generatePrismaClient should run prisma generate', () => {
    const runCommand = jest.spyOn(plugin, 'runCommand');

    plugin.generatePrismaClient(mockCwd);

    expect(runCommand).toHaveBeenCalledWith('npm', ['run', 'prisma:generate'], {
      cwd: mockCwd,
    });
  });

  test('deleteUnusedEngines should delete unused engines', () => {
    const engines = ['engine1', 'engine2'];
    jest.spyOn(glob, 'globSync').mockReturnValue(engines);
    plugin.deleteUnusedEngines(mockCwd);

    engines.forEach((engine) => {
      expect(fs.rmSync).toHaveBeenCalledWith(path.join(mockCwd, engine), {
        force: true,
      });
    });
  });

  test('getFunctionNames should return service if package individually is false', () => {
    _.set(mockServerless, 'service.package.individually', false);
    const result = plugin.getFunctionNames();
    expect(result).toEqual(['service']);
  });

  test('getFunctionNames should return list of functions if package individually is true', () => {
    _.set(mockServerless, 'service.package.individually', true);

    const result = plugin.getFunctionNames();
    const expected = Object.keys(mockFunctions);

    expect(result).toEqual(expected);
  });

  test('getIgnoredFunctions should return ignored functions', () => {
    const ignoredFunctions = ['fn2', 'fn3'];
    _.set(
      mockServerless,
      'service.custom.prisma.ignoreFunctions',
      ignoredFunctions
    );
    const result = plugin.getIgnoredFunctions();
    expect(result).toBe(ignoredFunctions);
  });

  test('getNodeFunctions should exclude ignored functions & functions that use docker image', () => {
    _.set(mockServerless, 'service.custom.prisma.ignoreFunctions', ['fn3']);
    _.set(
      mockServerless,
      'service.functions',
      _.merge(mockServerless.service.functions, {
        fn3: {},
        fn4: {
          runtime: 'python3.9',
        },
        fn5: {
          image: 'dummy',
        },
      })
    );

    const result = plugin.getNodeFunctions();
    const expected = ['fn1', 'fn2'];

    expect(result).toStrictEqual(expected);
  });
});
