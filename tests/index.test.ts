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

  beforeEach(() => {
    mockLogger = jest.fn();
    mockServerless = {
      service: {
        custom: {
          webpack: {},
          prisma: {},
        },
        provider: {},
        getAllFunctions: jest.fn(),
        getFunction: jest.fn(),
      },
      config: { servicePath: '/service/path' },
    } as unknown as Serverless;
    mockOptions = {};
    plugin = new ServerlessWebpackPrisma(mockServerless, mockOptions, {
      writeText: mockLogger,
    });
  });

  beforeEach(() => {
    jest.spyOn(childProcess, 'execSync').mockReturnValue('');
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
    jest.spyOn(_, 'get').mockReturnValue('x86_64');
    const architecture = plugin.getArchitecture();
    expect(architecture).toBe('x86_64');
  });

  test('getArchitecture should return custom architecture', () => {
    jest.spyOn(_, 'get').mockReturnValue('arm64');
    const architecture = plugin.getArchitecture();
    expect(architecture).toBe('arm64');
  });

  test('getPackageManager should return the default package manager', () => {
    jest.spyOn(_, 'get').mockReturnValue('npm');
    const result = plugin.getPackageManager();
    expect(result).toBe('npm');
  });

  test('getPackageManager should return a custom package manager', () => {
    jest.spyOn(_, 'get').mockReturnValue('yarn');
    const result = plugin.getPackageManager();
    expect(result).toBe('yarn');
  });

  test('getPrismaVersion should return the prisma version', () => {
    jest.spyOn(_, 'get').mockReturnValue('5.0.0');
    const result = plugin.getPrismaVersion();
    expect(result).toBe('5.0.0');
  });

  test('getInstallDeps should return the installDeps value', () => {
    jest.spyOn(_, 'get').mockReturnValue(true);
    const result = plugin.getInstallDeps();
    expect(result).toBe(true);
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

  test('managePackageScripts should remove prisma generate script', () => {
    const packageJson = { scripts: { 'prisma:generate': 'prisma generate' } };
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(packageJson));
    plugin.managePackageScripts('remove', mockCwd);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(mockCwd, 'package.json'),
      JSON.stringify({ scripts: {} }, null, 2)
    );
  });

  test('installPrismaPackage should install prisma', () => {
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
    expect(rmSync).toHaveBeenCalledWith(
      path.join(mockCwd, 'node_modules', '.bin/prisma'),
      { recursive: true, force: true }
    );
    expect(rmSync).toHaveBeenCalledWith(
      path.join(mockCwd, 'node_modules', 'prisma'),
      { recursive: true, force: true }
    );
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
    jest.spyOn(glob, 'globSync').mockReturnValue(['engine1', 'engine2']);
    plugin.deleteUnusedEngines(mockCwd);

    expect(fs.rmSync).toHaveBeenCalledWith(path.join(mockCwd, 'engine1'), {
      force: true,
    });
    expect(fs.rmSync).toHaveBeenCalledWith(path.join(mockCwd, 'engine2'), {
      force: true,
    });
  });

  test('getFunctionNames should return service if package individually is false', () => {
    jest.spyOn(_, 'get').mockReturnValue(false);
    const result = plugin.getFunctionNames();
    expect(result).toEqual(['service']);
  });

  test('getFunctionNames should return node functions if package individually is true', () => {
    jest.spyOn(_, 'get').mockReturnValue(true);
    const mockNodeFunctions = ['func1', 'func2'];
    plugin.getNodeFunctions = jest.fn().mockReturnValue(mockNodeFunctions);

    const result = plugin.getFunctionNames();
    expect(result).toEqual(mockNodeFunctions);
  });

  test('getIgnoredFunctions should return ignored functions', () => {
    const ignoredFunctions = ['func1', 'func2'];
    jest.spyOn(_, 'get').mockReturnValue(ignoredFunctions);

    const result = plugin.getIgnoredFunctions();
    expect(result).toBe(ignoredFunctions);
  });

  test('getNodeFunctions should return valid Node.js functions', () => {
    const functions = ['func1', 'func2'];
    jest
      .spyOn(mockServerless.service, 'getAllFunctions')
      .mockReturnValue(functions);

    plugin.isFunctionImage = (jest.fn() as any).mockReturnValue(false);
    plugin.isRuntimeNode = jest.fn().mockReturnValue(true);
    plugin.isFunctionIgnored = jest.fn().mockReturnValue(false);

    const result = plugin.getNodeFunctions();
    expect(result).toEqual(functions);
  });

  test('onBeforeWebpackPackage should perform all necessary tasks', () => {
    const installPrismaPackage = jest.spyOn(plugin, 'installPrismaPackage');
    const managePrismaSchema = jest.spyOn(plugin, 'managePrismaSchema');
    const generatePrismaClient = jest.spyOn(plugin, 'generatePrismaClient');
    const deleteUnusedEngines = jest.spyOn(plugin, 'deleteUnusedEngines');
    const removePrismaPackage = jest.spyOn(plugin, 'removePrismaPackage');

    jest.spyOn(plugin, 'getPrismaEngines').mockReturnValue([]);
    jest.spyOn(plugin, 'getFunctionNames').mockReturnValue(['func1']);
    jest.spyOn(plugin, 'getInstallDeps').mockReturnValue(true);
    jest.spyOn(plugin, 'getUseSymlink').mockReturnValue(false);
    jest.spyOn(plugin, 'getPrismaPath').mockReturnValue('/prisma/path');
    jest.spyOn(plugin, 'getWebpackOutputPath').mockReturnValue('/fake-dir');

    plugin.onBeforeWebpackPackage();

    [
      installPrismaPackage,
      generatePrismaClient,
      deleteUnusedEngines,
      removePrismaPackage,
    ].forEach((fn) =>
      expect(fn).toHaveBeenCalledWith('/fake-dir/.webpack/func1')
    );

    expect(managePrismaSchema).toHaveBeenCalledWith(
      'copy',
      '/fake-dir/.webpack/func1',
      path.join('/prisma/path', 'prisma')
    );
  });
});
