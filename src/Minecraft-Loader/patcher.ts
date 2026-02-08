/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { getPathLibraries, getFileFromArchive } from '../utils/Index.js';
import type {
	PatcherProfile,
	PatcherConfig,
	PatcherProcessor,
	MinecraftLibrary
} from '../types.js';

export type { PatcherProfile as Profile };

interface ForgePatcherOptions {
	path: string;
	loader: {
		type: string;
	};
}

export default class ForgePatcher extends EventEmitter {
	private readonly options: ForgePatcherOptions;

	constructor(options: ForgePatcherOptions) {
		super();
		this.options = options;
	}

	public async patcher(profile: PatcherProfile, config: PatcherConfig, neoForgeOld: boolean = true): Promise<void> {
		const { processors } = profile;

		for (const [_, processor] of Object.entries(processors)) {
			if (processor.sides && !processor.sides.includes('client')) continue;

			const jarInfo = getPathLibraries(processor.jar);
			const jarPath = path.resolve(this.options.path, 'libraries', jarInfo.path, jarInfo.name);

			const args = processor.args
				.map(arg => this.setArgument(arg, profile, config, neoForgeOld))
				.map(arg => this.computePath(arg));

			const classPaths = processor.classpath.map(cp => {
				const cpInfo = getPathLibraries(cp);
				return `"${path.join(this.options.path, 'libraries', cpInfo.path, cpInfo.name)}"`;
			});

			const mainClass = await this.readJarManifest(jarPath);
			if (!mainClass) {
				this.emit('error', `Impossible de déterminer la classe principale dans le JAR: ${jarPath}`);
				continue;
			}

			await new Promise<void>((resolve) => {
				const spawned = spawn(
					`"${path.resolve(config.java)}"`,
					[
						'-classpath',
						[`"${jarPath}"`, ...classPaths].join(path.delimiter),
						mainClass,
						...args
					],
					{ shell: true }
				);

				spawned.stdout.on('data', data => {
					this.emit('patch', data.toString('utf-8'));
				});

				spawned.stderr.on('data', data => {
					this.emit('patch', data.toString('utf-8'));
				});

				spawned.on('close', code => {
					if (code !== 0) {
						this.emit('error', `Le patcher Forge s'est terminé avec le code ${code}`);
					}
					resolve();
				});
			});
		}
	}

	public check(profile: PatcherProfile): boolean {
		const { processors } = profile;
		let files: string[] = [];

		for (const processor of Object.values(processors!)) {
			if (processor.sides && !processor.sides.includes('client')) continue;

			processor.args.forEach(arg => {
				const finalArg = arg.replace('{', '').replace('}', '');
				if (profile.data[finalArg]) {
					if (finalArg === 'BINPATCH') return;
					files.push(profile.data[finalArg].client);
				}
			});
		}

		files = Array.from(new Set(files));

		for (const file of files) {
			const lib = getPathLibraries(file.replace('[', '').replace(']', ''));
			const filePath = path.resolve(this.options.path, 'libraries', lib.path, lib.name);
			if (!fs.existsSync(filePath)) return false;
		}
		return true;
	}

	private setArgument(arg: string, profile: PatcherProfile, config: PatcherConfig, neoForgeOld: boolean): string {
		const finalArg = arg.replace('{', '').replace('}', '');

		const universalLib = profile.libraries?.find(lib => {
			if (this.options.loader.type === 'forge') return lib.name.startsWith('net.minecraftforge:forge');
			else return lib.name.startsWith(neoForgeOld ? 'net.neoforged:forge' : 'net.neoforged:neoforge');
		});

		if (profile.data[finalArg]) {
			if (finalArg === 'BINPATCH') {
				const jarInfo = getPathLibraries(profile.path || (universalLib?.name ?? ''));
				return `"${path.join(this.options.path, 'libraries', jarInfo.path, jarInfo.name).replace('.jar', '-clientdata.lzma')}"`;
			}
			return profile.data[finalArg].client;
		}

		return arg
			.replace('{SIDE}', 'client')
			.replace('{ROOT}', `"${path.dirname(path.resolve(this.options.path, 'forge'))}"`)
			.replace('{MINECRAFT_JAR}', `"${config.minecraft}"`)
			.replace('{MINECRAFT_VERSION}', `"${config.minecraftJson}"`)
			.replace('{INSTALLER}', `"${path.join(this.options.path, 'libraries')}"`)
			.replace('{LIBRARY_DIR}', `"${path.join(this.options.path, 'libraries')}"`);
	}

	private computePath(arg: string): string {
		if (arg.startsWith('[')) {
			const libInfo = getPathLibraries(arg.replace('[', '').replace(']', ''));
			return `"${path.join(this.options.path, 'libraries', libInfo.path, libInfo.name)}"`;
		}
		return arg;
	}

	private async readJarManifest(jarPath: string): Promise<string | null> {
		const manifestContent = await getFileFromArchive(jarPath, 'META-INF/MANIFEST.MF');
		if (!manifestContent) return null;

		const content = manifestContent.toString();
		const mainClassLine = content.split('Main-Class: ')[1];
		if (!mainClassLine) return null;
		return mainClassLine.split('\r\n')[0];
	}
}
